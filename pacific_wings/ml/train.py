"""
Fit and select the route market-size model.

The target is the monthly TOTAL ROUTE MARKET (one-way-equivalent passengers,
all carriers) from `demand_observations.market_passengers` - real BITRE
city-pair figures for SIN/HND/AKL/DAD, a published-total anchor for SYD-MEL
(see etl/fetch_real_aviation_stats.py).

The target is deliberately the whole market, not Pacific Wings' slice of it.
Pacific Wings' carried passengers are derived at simulation time as
market x modeled share, capped by capacity (pacific_wings/simulation/engine.py). Training
on a pre-shared, pre-capped label - as this pipeline did until the
correctness pass - made the label a function of Pacific Wings' own fleet
decisions, so the model learned its own capacity ceiling and no strategy
lever could move the forecast.

2022 is excluded entirely: it was the COVID border-reopening ramp (Japan only
reopened to tourism in Oct 2022), unrepresentative of the steady state the
simulator forecasts.

WHAT THIS RUN DECIDES
Two candidate models (pacific_wings/ml/market_model.py) and two naive baselines are scored
on one forward-looking holdout: train on 2023, predict 2024. The best
candidate is written to models/market_model.json and becomes the deployed
model. If a naive baseline beats both candidates, the run says so loudly -
a learned model that cannot beat same-month-last-year is not paying for its
complexity, and an earlier version of this pipeline reported R2=0.97 while
quietly losing to a groupby mean.

Two further checks are recorded in models/metrics.json:
  - LEAVE-ONE-ROUTE-OUT cross-validation (GroupKFold on destination), which
    replaced a shuffled KFold that leaked - shuffling a monthly panel puts a
    route's adjacent months in both folds, and since distance and population
    are constant per route the model could then identify its own test rows.
    It scored 0.992 that way against an honest 0.965, and read as stability
    when it was leakage. Leave-one-route-out asks the harder question that
    /analyze_route actually depends on: can this transfer to an unseen route?
  - OUT-OF-FOLD residual quantiles from rolling-origin refits (for each year,
    train on the other years and predict that year). pacific_wings/api/ builds its
    prediction interval from these and pacific_wings/ml/confidence.py builds the per-route
    reliability deduction from them. They previously came from the 2023-only
    holdout model while a different, all-rows model was deployed, so the
    published bands carried a discarded model's per-route bias.

Usage:
    python pacific_wings/ml/train.py

Outputs:
    models/market_model.json     Selected model + its parameters + the scoreboard
    models/metrics.json          Holdout metrics, baselines, CV, residual quantiles
    models/bootstrap.json        Resampling spread per route/month, for confidence
    models/demand_model.json     XGBoost booster (only when XGBoost wins selection)
    models/feature_columns.json  Ordered feature columns (only when XGBoost wins)
"""

import json
import os

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, r2_score
from sklearn.model_selection import GroupKFold
from sqlalchemy import create_engine

from pacific_wings import paths
from pacific_wings.ml.features import FEATURE_COLUMNS, ReferenceData
from pacific_wings.ml.market_model import SEASONAL_INDEX, XGBOOST, fit_seasonal_index

ROOT = paths.ROOT
MODELS_DIR = ROOT / "models"

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://airline:airline@localhost:5432/airline_sim"
)

TARGET = "market_passengers"
TEST_YEAR = 2024
MIN_TRAIN_YEAR = 2023  # 2022 = COVID reopening ramp, excluded (see module docstring)
RANDOM_STATE = 42
N_BOOTSTRAP = 200  # resamples for the confidence spread; cheap now that it is arithmetic

MODEL_PARAMS = dict(
    n_estimators=150,
    max_depth=3,
    learning_rate=0.1,
    subsample=0.9,
    colsample_bytree=0.9,
    random_state=RANDOM_STATE,
)


def _score(actual, predicted) -> dict:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "mape": float(mean_absolute_percentage_error(actual, predicted)),
        "r2": float(r2_score(actual, predicted)),
    }


# Relative MAPE margin a learned model must clear before it can claim to
# beat a naive baseline. Anything smaller is noise on 60 holdout rows.
BASELINE_MARGIN = 0.02


def _baseline_verdict(model_mape: float, baselines: dict, n_train_years: int = 0) -> dict:
    """Compare the deployed model against the best naive baseline, honestly.

    With a single training year the seasonal index is not merely close to
    `same_month_last_year`, it IS that forecaster: fit on one year, `base` is
    that year's mean and `month_index[m]` is that year's month m divided by it,
    so `base * month_index[m]` reproduces the observation exactly. The tie is
    an algebraic identity, and the artifact used to report it as an empirical
    result - "ties_baseline, relative_improvement 1.3e-16" reads like a close
    race that a reader might expect a better model to win. It says so now.
    """
    if not baselines:
        return {"status": "no_baselines"}
    best = min(baselines, key=lambda k: baselines[k]["mape"])
    best_mape = baselines[best]["mape"]
    improvement = (best_mape - model_mape) / best_mape if best_mape else 0.0
    if improvement > BASELINE_MARGIN:
        status = "beats_baseline"
    elif improvement < -BASELINE_MARGIN:
        status = "LOSES_TO_BASELINE"
    else:
        status = "ties_baseline"
    verdict = {
        "status": status,
        "best_baseline": best,
        "best_baseline_mape": best_mape,
        "model_mape": model_mape,
        "relative_improvement": improvement,
        "margin_required": BASELINE_MARGIN,
    }
    if n_train_years < 2:
        verdict["status"] = "identical_by_construction"
        verdict["degenerate"] = True
        verdict["note"] = (
            f"{n_train_years} training year(s): a seasonal index fitted on a single year "
            "reproduces that year exactly, so it and same_month_last_year are the same "
            "estimator. This comparison cannot discriminate and will not until a third "
            "year of observations exists. The deployed artifact is a per-route level "
            "with a per-month shape - not a model that beat anything."
        )
    return verdict


def _predict_seasonal(params: dict, destinations, months) -> np.ndarray:
    """Predict with a fitted seasonal index, falling back to the mean level
    across known routes for a route the fit never saw (leave-one-route-out)."""
    fallback = float(np.mean([p["base"] for p in params.values()])) if params else 0.0
    return np.array(
        [
            params[d]["base"] * params[d]["month_index"][m - 1] if d in params else fallback
            for d, m in zip(destinations, months)
        ]
    )


def score_baselines(obs: pd.DataFrame, test_year: int) -> dict:
    """Two naive forecasters on the holdout the candidates are graded on."""
    train, test = obs[obs["year"] < test_year], obs[obs["year"] == test_year]
    if train.empty or test.empty:
        return {}

    route_mean = train.groupby("destination")[TARGET].mean()
    last_year = train.set_index(["destination", "month"])[TARGET]

    candidates = {
        "route_mean_of_prior_years": test["destination"].map(route_mean),
        "same_month_last_year": pd.Series(
            [last_year.get((d, m), np.nan) for d, m in zip(test["destination"], test["month"])],
            index=test.index,
        ),
    }

    scored = {}
    for name, pred in candidates.items():
        mask = pred.notna()
        if mask.any():
            scored[name] = _score(test.loc[mask, TARGET], pred[mask])
    return scored


def select_model(obs: pd.DataFrame, X: pd.DataFrame) -> tuple[str, dict, dict]:
    """Fit both candidates on the training years, score both on the holdout,
    return (winning kind, its scoreboard, all scores)."""
    train_mask = (obs["year"] < TEST_YEAR).to_numpy()
    train, test = obs[train_mask], obs[~train_mask]
    y_test = test[TARGET]

    scores = {}

    seasonal_params = fit_seasonal_index(train, TARGET)
    scores[SEASONAL_INDEX] = _score(
        y_test, _predict_seasonal(seasonal_params, test["destination"], test["month"])
    )

    booster = xgb.XGBRegressor(**MODEL_PARAMS)
    booster.fit(X[train_mask], obs.loc[train_mask, TARGET])
    scores[XGBOOST] = _score(y_test, booster.predict(X[~train_mask]))

    winner = min(scores, key=lambda k: scores[k]["mape"])
    return winner, scores[winner], scores


def cross_validate(obs: pd.DataFrame, X: pd.DataFrame, kind: str) -> dict:
    """Leave-one-route-out CV. Grouping by destination is what makes it
    honest: a shuffled split would put a route's adjacent months on both
    sides of the fold boundary, and since distance and population are
    constant per route, the model could then identify its own test rows."""
    groups = obs["destination"]
    splitter = GroupKFold(n_splits=groups.nunique())
    folds = {"mae": [], "mape": [], "r2": []}
    per_route = {}

    for train_idx, test_idx in splitter.split(X, obs[TARGET], groups):
        train, test = obs.iloc[train_idx], obs.iloc[test_idx]
        if kind == SEASONAL_INDEX:
            pred = _predict_seasonal(
                fit_seasonal_index(train, TARGET), test["destination"], test["month"]
            )
        else:
            fold_model = xgb.XGBRegressor(**MODEL_PARAMS)
            fold_model.fit(X.iloc[train_idx], train[TARGET])
            pred = fold_model.predict(X.iloc[test_idx])

        fold = _score(test[TARGET], pred)
        for metric, value in fold.items():
            folds[metric].append(value)
        per_route[test["destination"].iloc[0]] = {"mae": fold["mae"], "mape": fold["mape"]}

    return {
        "scheme": "leave-one-route-out (GroupKFold on destination)",
        "n_splits": int(groups.nunique()),
        "held_out_route": per_route,
        "interpretation": (
            "Error here is large by construction: with five routes the only features "
            "separating them are constants, so no model transfers to an unseen route. "
            "New destinations are served by the gravity model in "
            "pacific_wings/analysis/open_route.py, not by this one."
        ),
        **{
            f"{metric}_{stat}": float(getattr(np, stat)(values))
            for metric, values in folds.items()
            for stat in ("mean", "std")
        },
    }


def out_of_fold_residuals(obs: pd.DataFrame, X: pd.DataFrame, kind: str) -> np.ndarray:
    """Rolling-origin out-of-fold predictions: for each year, refit on the
    other years and predict it, so every row is scored by a model that never
    saw it - under the deployed configuration, unlike the single holdout
    model, which is discarded before deployment. Each fold trains on less
    data than the deployed model, so the resulting band is mildly
    conservative, which is the right direction for an uncertainty estimate.
    """
    oof = np.full(len(obs), np.nan)
    for year in sorted(obs["year"].unique()):
        holdout = (obs["year"] == year).to_numpy()
        if holdout.all():
            continue
        if kind == SEASONAL_INDEX:
            params = fit_seasonal_index(obs[~holdout], TARGET)
            oof[holdout] = _predict_seasonal(
                params, obs.loc[holdout, "destination"], obs.loc[holdout, "month"]
            )
        else:
            fold_model = xgb.XGBRegressor(**MODEL_PARAMS)
            fold_model.fit(X[~holdout], obs.loc[~holdout, TARGET])
            oof[holdout] = fold_model.predict(X[holdout])
    return obs[TARGET].to_numpy() - oof


def per_route_relative_residual_quantiles(
    destinations: pd.Series, residuals: np.ndarray, actuals: pd.Series
) -> dict:
    """The same spread expressed as a FRACTION of the actual value.

    The absolute version below is what the confidence score used to read, and
    it made confidence a proxy for route size: the same relative error scored
    Tokyo at 25% confidence and Singapore at 66% purely because Tokyo is the
    smaller market. Scale-free is what a reliability signal has to be.

    Also worth reading honestly: with two observed years the rolling-origin
    refit predicts each year from the other, so every route's quantiles come
    out perfectly symmetric around zero - these are one year-over-year
    difference, not a distribution of forecast errors. They widen into
    something real the moment a third year of history exists.
    """
    by_route = {}
    actual_values = actuals.to_numpy(dtype=float)
    for dest in destinations.unique():
        mask = (destinations == dest).to_numpy()
        rel = residuals[mask] / np.where(actual_values[mask] == 0, np.nan, actual_values[mask])
        rel = rel[~np.isnan(rel)]
        if len(rel):
            by_route[dest] = {f"p{q}": float(np.percentile(rel, q)) for q in (10, 25, 50, 75, 90)}
    return by_route


def per_route_residual_quantiles(destinations: pd.Series, residuals: np.ndarray) -> dict:
    """Residual quantiles split by destination rather than pooled.

    Pooling is actively misleading now that the target is total market size:
    SYD-MEL runs ~386k passengers a month against DAD's ~1.4k, so a pooled
    passenger residual is simply the largest route's. Only ~24 out-of-fold
    rows per route, so treat these as rough.
    """
    by_route = {}
    for dest in destinations.unique():
        route_residuals = residuals[(destinations == dest).to_numpy()]
        route_residuals = route_residuals[~np.isnan(route_residuals)]
        if len(route_residuals):
            by_route[dest] = {
                f"p{q}": float(np.percentile(route_residuals, q)) for q in (10, 25, 50, 75, 90)
            }
    return by_route


def bootstrap_spread(obs: pd.DataFrame, kind: str) -> dict:
    """Resampling spread per route/month, as a coefficient of variation.

    Refits the model on N_BOOTSTRAP resamples-with-replacement of the
    training rows and records how much each route/month prediction moves.
    This is the epistemic signal pacific_wings/ml/confidence.py deducts against: how much
    the answer depends on exactly which rows happened to be observed.

    Replaces an earlier ensemble of 30 saved XGBoost models, which cost a
    model load and 30 predictions per forecast - roughly 125ms, or a full
    minute across a 500-trial Monte Carlo run - to produce a number that is
    a few floats.
    """
    if kind != SEASONAL_INDEX:
        return {}

    rng = np.random.default_rng(RANDOM_STATE)
    samples: dict[str, dict[int, list[float]]] = {}
    for _ in range(N_BOOTSTRAP):
        resample = obs.iloc[rng.integers(0, len(obs), size=len(obs))]
        for dest, route in fit_seasonal_index(resample, TARGET).items():
            for month in range(1, 13):
                samples.setdefault(dest, {}).setdefault(month, []).append(
                    route["base"] * route["month_index"][month - 1]
                )

    spread = {}
    for dest, by_month in samples.items():
        spread[dest] = {}
        for month, values in by_month.items():
            mean = float(np.mean(values))
            spread[dest][str(month)] = float(np.std(values) / mean) if mean > 0 else 0.0
    return spread


def compute_feature_ranges(X: pd.DataFrame) -> dict:
    """Per-feature min/max observed in training - lets a caller flag when a
    request extrapolates beyond the space the model was actually fitted on."""
    return {
        col: {"min": float(X[col].min()), "max": float(X[col].max())} for col in X.columns
    }


def load_observations(engine) -> pd.DataFrame:
    columns = ["destination", "year", "month", TARGET, "avg_fare_usd"]
    try:
        return pd.read_sql(
            f"""
            SELECT r.destination, d.year, d.month, d.{TARGET}, d.avg_fare_usd
            FROM demand_observations d
            JOIN routes r ON r.route_id = d.route_id
            """,
            engine,
        )
    except Exception:
        # DB not running - fall back to the CSV the DB is loaded from
        # (etl/load_db.py); identical rows, so training is unaffected.
        csv = pd.read_csv(ROOT / "data" / "processed" / "demand_observations.csv")
        print("Postgres unavailable - training from data/processed/demand_observations.csv")
        return csv[columns]


DOC_PATH = ROOT / "docs" / "model_metrics.md"


def write_metrics_doc(metrics: dict) -> None:
    """Render the scoreboard into docs/model_metrics.md.

    Generated rather than hand-written because the hand-written version drifted:
    the docs claimed R2=0.952 / MAPE 15.3% with CV 0.966 +/- 0.014 while
    metrics.json said 0.965 / 11.0% with CV 0.992 +/- 0.003, and the README
    pointed readers at the stale one as "the full math". A doc that regenerates
    on every training run cannot disagree with the artifact it describes.
    """
    verdict = metrics["verdict_vs_baselines"]
    cv = metrics["cross_validation"]

    rows = [
        f"| {name} | {s['mape']:.2%} | {s['mae']:,.0f} | {s['r2']:.3f} | "
        f"{'**deployed**' if name == metrics['selected_model'] else 'candidate'} |"
        for name, s in metrics["candidates"].items()
    ] + [
        f"| {name} | {s['mape']:.2%} | {s['mae']:,.0f} | {s['r2']:.3f} | baseline |"
        for name, s in metrics["baselines"].items()
    ]

    residuals = chr(10).join(
        f"| {dest} | {rq['p10']:,.0f} | {rq['p50']:,.0f} | {rq['p90']:,.0f} |"
        for dest, rq in metrics["residual_quantiles_by_route"].items()
    )

    DOC_PATH.write_text(
        f"""<!-- GENERATED by pacific_wings/ml/train.py. Do not edit by hand. -->

# Model metrics

Target: `{metrics['target']}` - the monthly TOTAL route market, one-way-equivalent,
all carriers. Pacific Wings' own passengers are derived at simulation time as
market x share, capped by capacity (`pacific_wings/simulation/engine.py`).

Deployed model: **{metrics['selected_model']}**, selected by lowest MAPE on the
{metrics['test_year']} holdout ({metrics['n_train']} train rows, {metrics['n_test']} test rows).

## Scoreboard

| model | MAPE | MAE | R2 | role |
|---|---|---|---|---|
{chr(10).join(rows)}

**vs the best baseline** ({verdict['best_baseline']}):
{verdict['relative_improvement']:+.1%} MAPE -> `{verdict['status']}`
(a model must beat a naive forecaster by more than
{verdict['margin_required']:.0%} to claim a win; floating point makes an exact
tie look like a victory by 1e-16).

## Leave-one-route-out cross-validation

MAPE {cv['mape_mean']:.1%} +/- {cv['mape_std']:.1%} across {cv['n_splits']} folds.

{cv['interpretation']}

This replaced a shuffled k-fold that leaked: shuffling a monthly panel puts a
route's adjacent months in both folds, and distance and population are constant
per route, so the model could identify its own test rows.

## Out-of-fold residual quantiles, by route

From rolling-origin refits - for each year, train on the other years and predict
it. `pacific_wings/api/` builds its prediction interval from these and
`pacific_wings/ml/confidence.py` builds the per-route reliability deduction from them.

| route | p10 | p50 | p90 |
|---|---|---|---|
{residuals}

Pooling these would be meaningless: SYD-MEL runs ~386k passengers a month
against DAD's ~1.4k.

Observed years: {metrics['train_year_min']}-{metrics['train_year_max']}.
Bootstrap resamples for the confidence spread: {metrics['n_bootstrap']}.
""",
        encoding="utf-8",
    )


def main() -> None:
    engine = create_engine(DATABASE_URL)
    obs = load_observations(engine)
    obs = obs[obs["year"] >= MIN_TRAIN_YEAR].reset_index(drop=True)
    ref = ReferenceData()

    X = pd.DataFrame(
        [
            ref.build_features(row.destination, row.year, row.month, row.avg_fare_usd)
            for row in obs.itertuples()
        ]
    )[FEATURE_COLUMNS]

    kind, holdout, candidate_scores = select_model(obs, X)
    baselines = score_baselines(obs, TEST_YEAR)

    residuals = out_of_fold_residuals(obs, X, kind)
    finite = residuals[~np.isnan(residuals)]

    MODELS_DIR.mkdir(exist_ok=True)

    # The deployed model is refit on ALL rows including the holdout year -
    # the holdout grades the protocol, not this final fit.
    if kind == SEASONAL_INDEX:
        params = fit_seasonal_index(obs, TARGET)
        importances = {}
    else:
        booster = xgb.XGBRegressor(**MODEL_PARAMS)
        booster.fit(X, obs[TARGET])
        booster.save_model(MODELS_DIR / "demand_model.json")
        (MODELS_DIR / "feature_columns.json").write_text(json.dumps(FEATURE_COLUMNS, indent=2))
        params = {"feature_columns": FEATURE_COLUMNS}
        importances = dict(zip(FEATURE_COLUMNS, booster.feature_importances_.astype(float)))

    (MODELS_DIR / "market_model.json").write_text(
        json.dumps(
            {
                "kind": kind,
                "target": TARGET,
                "params": params,
                "selection": {
                    "criterion": f"lowest MAPE on the {TEST_YEAR} holdout",
                    "candidates": candidate_scores,
                    "baselines": baselines,
                },
            },
            indent=2,
        )
    )
    (MODELS_DIR / "bootstrap.json").write_text(json.dumps(bootstrap_spread(obs, kind), indent=2))

    metrics = {
        "target": TARGET,
        "selected_model": kind,
        "test_year": TEST_YEAR,
        "n_train": int((obs["year"] < TEST_YEAR).sum()),
        "n_test": int((obs["year"] == TEST_YEAR).sum()),
        **holdout,
        "candidates": candidate_scores,
        "baselines": baselines,
        # A margin, not a strict inequality: floating point makes an exact tie
        # read as a win by 1e-16, and "beats the baseline" is precisely the
        # claim that must not be overstated here. With a single training year
        # the seasonal index IS same-month-last-year, so a tie is the expected
        # honest result until a third year of history exists.
        "verdict_vs_baselines": _baseline_verdict(
            holdout["mape"], baselines, n_train_years=int(obs[obs["year"] < TEST_YEAR]["year"].nunique())
        ),
        "cross_validation": cross_validate(obs, X, kind),
        "residual_quantiles": {
            f"p{q}": float(np.percentile(finite, q)) for q in (10, 25, 50, 75, 90)
        },
        "residual_quantiles_by_route": per_route_residual_quantiles(obs["destination"], residuals),
        "relative_residual_quantiles_by_route": per_route_relative_residual_quantiles(
            obs["destination"], residuals, obs[TARGET]
        ),
        "relative_residual_quantiles": {
            f"p{q}": float(np.nanpercentile(residuals / obs[TARGET].to_numpy(dtype=float), q))
            for q in (10, 25, 50, 75, 90)
        },
        "feature_importances": importances,
        "feature_ranges": compute_feature_ranges(X),
        "train_year_min": int(obs["year"].min()),
        "train_year_max": int(obs["year"].max()),
        "n_bootstrap": N_BOOTSTRAP,
    }
    (MODELS_DIR / "metrics.json").write_text(json.dumps(metrics, indent=2))
    write_metrics_doc(metrics)

    print(f"\nSelected: {kind}  (lowest MAPE on the {TEST_YEAR} holdout)")
    print(f"{'candidate':<28} {'MAPE':>8} {'MAE':>12} {'R2':>8}")
    for name, s in candidate_scores.items():
        marker = "  <-- deployed" if name == kind else ""
        print(f"{name:<28} {s['mape']:>7.2%} {s['mae']:>12,.0f} {s['r2']:>8.3f}{marker}")
    for name, s in baselines.items():
        print(f"{name + ' (baseline)':<28} {s['mape']:>7.2%} {s['mae']:>12,.0f} {s['r2']:>8.3f}")

    verdict = metrics["verdict_vs_baselines"]
    print(
        f"\nvs best baseline ({verdict['best_baseline']}): "
        f"{verdict['relative_improvement']:+.1%} MAPE -> {verdict['status']}"
    )
    if verdict["status"] == "LOSES_TO_BASELINE":
        print("!! Ship the baseline instead, or stop claiming the model forecasts anything.")
    elif verdict["status"] == "ties_baseline":
        print(
            "   A tie is the expected honest result while only one training year exists:\n"
            "   with a single year the seasonal index reduces exactly to same-month-last-year.\n"
            "   It starts earning its keep once a third year lets each month average over\n"
            "   more than one observation."
        )

    cv = metrics["cross_validation"]
    print(f"\nLeave-one-route-out CV ({cv['n_splits']} folds): MAPE {cv['mape_mean']:.1%} +/- {cv['mape_std']:.1%}")
    print("  (large by construction - see metrics.json 'interpretation')")

    print("\nOut-of-fold residual quantiles by route (actual - predicted):")
    for dest, rq in metrics["residual_quantiles_by_route"].items():
        print(f"  {dest}: p10={rq['p10']:>10,.0f}  p50={rq['p50']:>10,.0f}  p90={rq['p90']:>10,.0f}")


if __name__ == "__main__":
    main()
