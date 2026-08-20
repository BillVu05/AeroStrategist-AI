"""
World airport and country macro database for open-route analysis.

Contains curated static data for ~200 major international airports and
2024 macro estimates for ~90 countries. Enables route analysis for any
worldwide destination, not just Pacific Wings' existing routes.

Sources:
  Airports: OurAirports (lat/lon), curated subset of commercial-service airports
  GDP:      IMF World Economic Outlook April 2024 (USD billions nominal)
  Population: UN World Population Prospects 2024 (millions)
  Tourism:  UNWTO 2019 baseline (international tourist arrivals, millions)
            — 2019 used as pre-COVID structural reference
"""

import math

# SYD coordinates (origin for all distance calculations)
SYD_LAT = -33.9461
SYD_LON = 151.177

# ─── airport database ─────────────────────────────────────────────────────────
# fmt: off
# Each entry: (iata, name, city, country_alpha2, lat, lon)
AIRPORTS: list[tuple[str, str, str, str, float, float]] = [
    # Australia / Pacific Wings origin
    ("SYD", "Sydney Kingsford Smith", "Sydney", "AU", -33.9461, 151.177),
    ("MEL", "Melbourne Airport", "Melbourne", "AU", -37.6733, 144.843),
    ("BNE", "Brisbane Airport", "Brisbane", "AU", -27.3842, 153.117),
    ("PER", "Perth Airport", "Perth", "AU", -31.9403, 115.967),
    ("ADL", "Adelaide Airport", "Adelaide", "AU", -34.9450, 138.531),
    ("CBR", "Canberra Airport", "Canberra", "AU", -35.3069, 149.195),
    ("DRW", "Darwin Airport", "Darwin", "AU", -12.4147, 130.877),
    ("CNS", "Cairns Airport", "Cairns", "AU", -16.8858, 145.755),
    # New Zealand
    ("AKL", "Auckland International Airport", "Auckland", "NZ", -37.0082, 174.792),
    ("CHC", "Christchurch International Airport", "Christchurch", "NZ", -43.4894, 172.532),
    ("WLG", "Wellington Airport", "Wellington", "NZ", -41.3272, 174.805),
    # Southeast Asia
    ("SIN", "Singapore Changi Airport", "Singapore", "SG", 1.3502, 103.994),
    ("KUL", "Kuala Lumpur International Airport", "Kuala Lumpur", "MY", 2.7456, 101.710),
    ("BKK", "Suvarnabhumi Airport", "Bangkok", "TH", 13.6811, 100.747),
    ("DMK", "Don Mueang International Airport", "Bangkok", "TH", 13.9126, 100.607),
    ("CGK", "Soekarno-Hatta International Airport", "Jakarta", "ID", -6.1256, 106.656),
    ("DPS", "Ngurah Rai (Bali) International Airport", "Bali", "ID", -8.7482, 115.167),
    ("MNL", "Ninoy Aquino International Airport", "Manila", "PH", 14.5086, 121.020),
    ("SGN", "Tan Son Nhat International Airport", "Ho Chi Minh City", "VN", 10.8188, 106.652),
    ("HAN", "Noi Bai International Airport", "Hanoi", "VN", 21.2212, 105.807),
    ("DAD", "Da Nang International Airport", "Da Nang", "VN", 16.0439, 108.199),
    ("RGN", "Yangon International Airport", "Yangon", "MM", 16.9073, 96.1332),
    ("PNH", "Phnom Penh International Airport", "Phnom Penh", "KH", 11.5466, 104.844),
    ("VTE", "Wattay International Airport", "Vientiane", "LA", 17.9883, 102.563),
    # Japan / Korea
    ("NRT", "Narita International Airport", "Tokyo", "JP", 35.7647, 140.386),
    ("HND", "Tokyo Haneda Airport", "Tokyo", "JP", 35.5494, 139.780),
    ("KIX", "Kansai International Airport", "Osaka", "JP", 34.4272, 135.244),
    ("NGO", "Chubu Centrair International Airport", "Nagoya", "JP", 34.8584, 136.805),
    ("FUK", "Fukuoka Airport", "Fukuoka", "JP", 33.5859, 130.451),
    ("ICN", "Incheon International Airport", "Seoul", "KR", 37.4692, 126.451),
    ("GMP", "Gimpo International Airport", "Seoul", "KR", 37.5580, 126.791),
    ("PUS", "Gimhae International Airport", "Busan", "KR", 35.1795, 128.938),
    # China / Taiwan / Hong Kong
    ("PEK", "Beijing Capital International Airport", "Beijing", "CN", 40.0799, 116.584),
    ("PKX", "Beijing Daxing International Airport", "Beijing", "CN", 39.5095, 116.412),
    ("PVG", "Shanghai Pudong International Airport", "Shanghai", "CN", 31.1434, 121.805),
    ("SHA", "Shanghai Hongqiao International Airport", "Shanghai", "CN", 31.1979, 121.336),
    ("CAN", "Guangzhou Baiyun International Airport", "Guangzhou", "CN", 23.3924, 113.299),
    ("SZX", "Shenzhen Bao'an International Airport", "Shenzhen", "CN", 22.6393, 113.811),
    ("CTU", "Chengdu Tianfu International Airport", "Chengdu", "CN", 30.3126, 104.444),
    ("KMG", "Kunming Changshui International Airport", "Kunming", "CN", 24.9921, 102.744),
    ("HKG", "Hong Kong International Airport", "Hong Kong", "HK", 22.3080, 113.915),
    ("TPE", "Taoyuan International Airport", "Taipei", "TW", 25.0777, 121.233),
    ("KHH", "Kaohsiung International Airport", "Kaohsiung", "TW", 22.5771, 120.350),
    # India
    ("DEL", "Indira Gandhi International Airport", "New Delhi", "IN", 28.5665, 77.1031),
    ("BOM", "Chhatrapati Shivaji Maharaj International Airport", "Mumbai", "IN", 19.0896, 72.8656),
    ("BLR", "Kempegowda International Airport", "Bengaluru", "IN", 13.1986, 77.7066),
    ("MAA", "Chennai International Airport", "Chennai", "IN", 12.9900, 80.1693),
    ("HYD", "Rajiv Gandhi International Airport", "Hyderabad", "IN", 17.2313, 78.4298),
    ("CCU", "Netaji Subhas Chandra Bose International Airport", "Kolkata", "IN", 22.6542, 88.4467),
    ("COK", "Cochin International Airport", "Kochi", "IN", 10.1520, 76.4019),
    ("AMD", "Sardar Vallabhbhai Patel International Airport", "Ahmedabad", "IN", 23.0772, 72.6347),
    # South Asia
    ("CMB", "Bandaranaike International Airport", "Colombo", "LK", 7.1808, 79.8841),
    ("DAC", "Hazrat Shahjalal International Airport", "Dhaka", "BD", 23.8433, 90.3978),
    ("KTM", "Tribhuvan International Airport", "Kathmandu", "NP", 27.6966, 85.3591),
    ("MLE", "Velana International Airport", "Male", "MV", 4.1918, 73.5290),
    # Middle East
    ("DXB", "Dubai International Airport", "Dubai", "AE", 25.2532, 55.3657),
    ("AUH", "Abu Dhabi International Airport", "Abu Dhabi", "AE", 24.4330, 54.6511),
    ("DOH", "Hamad International Airport", "Doha", "QA", 25.2731, 51.6081),
    ("BAH", "Bahrain International Airport", "Manama", "BH", 26.2708, 50.6336),
    ("RUH", "King Khalid International Airport", "Riyadh", "SA", 24.9576, 46.6988),
    ("JED", "King Abdulaziz International Airport", "Jeddah", "SA", 21.6796, 39.1565),
    ("MCT", "Muscat International Airport", "Muscat", "OM", 23.5933, 58.2844),
    ("KWI", "Kuwait International Airport", "Kuwait City", "KW", 29.2267, 47.9689),
    ("AMM", "Queen Alia International Airport", "Amman", "JO", 31.7226, 35.9932),
    ("BEY", "Rafic Hariri International Airport", "Beirut", "LB", 33.8209, 35.4884),
    ("TLV", "Ben Gurion International Airport", "Tel Aviv", "IL", 32.0114, 34.8867),
    ("IST", "Istanbul Airport", "Istanbul", "TR", 41.2753, 28.7519),
    ("SAW", "Istanbul Sabiha Gokcen Airport", "Istanbul", "TR", 40.8986, 29.3092),
    # Africa
    ("JNB", "OR Tambo International Airport", "Johannesburg", "ZA", -26.1392, 28.2460),
    ("CPT", "Cape Town International Airport", "Cape Town", "ZA", -33.9715, 18.6021),
    ("DUR", "King Shaka International Airport", "Durban", "ZA", -29.6144, 31.1197),
    ("NBO", "Jomo Kenyatta International Airport", "Nairobi", "KE", -1.3192, 36.9275),
    ("ADD", "Bole International Airport", "Addis Ababa", "ET", 8.9779, 38.7993),
    ("LOS", "Murtala Muhammed International Airport", "Lagos", "NG", 6.5774, 3.3212),
    ("ABV", "Nnamdi Azikiwe International Airport", "Abuja", "NG", 9.0068, 7.2632),
    ("ACC", "Kotoka International Airport", "Accra", "GH", 5.6052, -0.1668),
    ("CMN", "Mohammed V International Airport", "Casablanca", "MA", 33.3675, -7.5900),
    ("CAI", "Cairo International Airport", "Cairo", "EG", 30.1219, 31.4056),
    ("TUN", "Tunis-Carthage International Airport", "Tunis", "TN", 36.8510, 10.2272),
    ("ALG", "Houari Boumediene Airport", "Algiers", "DZ", 36.6910, 3.2154),
    ("DAR", "Julius Nyerere International Airport", "Dar es Salaam", "TZ", -6.8781, 39.2026),
    ("EBB", "Entebbe International Airport", "Kampala", "UG", 0.0424, 32.4435),
    ("MRU", "Sir Seewoosagur Ramgoolam International Airport", "Mauritius", "MU", -20.4302, 57.6836),
    # Europe
    ("LHR", "London Heathrow Airport", "London", "GB", 51.4775, -0.4614),
    ("LGW", "London Gatwick Airport", "London", "GB", 51.1537, -0.1821),
    ("STN", "London Stansted Airport", "London", "GB", 51.8850, 0.2350),
    ("CDG", "Charles de Gaulle Airport", "Paris", "FR", 49.0097, 2.5478),
    ("ORY", "Paris Orly Airport", "Paris", "FR", 48.7233, 2.3794),
    ("AMS", "Amsterdam Schiphol Airport", "Amsterdam", "NL", 52.3086, 4.7639),
    ("FRA", "Frankfurt Airport", "Frankfurt", "DE", 50.0379, 8.5622),
    ("MUC", "Munich Airport", "Munich", "DE", 48.3537, 11.7750),
    ("BER", "Berlin Brandenburg Airport", "Berlin", "DE", 52.3667, 13.5033),
    ("ZRH", "Zurich Airport", "Zurich", "CH", 47.4647, 8.5492),
    ("GVA", "Geneva Airport", "Geneva", "CH", 46.2380, 6.1090),
    ("MAD", "Adolfo Suárez Madrid–Barajas Airport", "Madrid", "ES", 40.4936, -3.5668),
    ("BCN", "Barcelona El Prat Airport", "Barcelona", "ES", 41.2971, 2.0785),
    ("FCO", "Rome Fiumicino Airport", "Rome", "IT", 41.8003, 12.2389),
    ("MXP", "Milan Malpensa Airport", "Milan", "IT", 45.6306, 8.7281),
    ("VIE", "Vienna International Airport", "Vienna", "AT", 48.1103, 16.5697),
    ("BRU", "Brussels Airport", "Brussels", "BE", 50.9014, 4.4844),
    ("LIS", "Humberto Delgado Airport", "Lisbon", "PT", 38.7756, -9.1359),
    ("OSL", "Oslo Gardermoen Airport", "Oslo", "NO", 60.1939, 11.1004),
    ("ARN", "Stockholm Arlanda Airport", "Stockholm", "SE", 59.6519, 17.9186),
    ("CPH", "Copenhagen Airport", "Copenhagen", "DK", 55.6181, 12.6561),
    ("HEL", "Helsinki-Vantaa Airport", "Helsinki", "FI", 60.3172, 24.9633),
    ("WAW", "Warsaw Chopin Airport", "Warsaw", "PL", 52.1657, 20.9671),
    ("PRG", "Václav Havel Airport Prague", "Prague", "CZ", 50.1008, 14.2600),
    ("BUD", "Budapest Ferenc Liszt International Airport", "Budapest", "HU", 47.4298, 19.2611),
    ("ATH", "Athens International Airport", "Athens", "GR", 37.9364, 23.9445),
    ("DUB", "Dublin Airport", "Dublin", "IE", 53.4213, -6.2701),
    ("MAN", "Manchester Airport", "Manchester", "GB", 53.3537, -2.2750),
    ("EDI", "Edinburgh Airport", "Edinburgh", "GB", 55.9500, -3.3725),
    # North America
    ("JFK", "John F. Kennedy International Airport", "New York", "US", 40.6413, -73.7781),
    ("LGA", "LaGuardia Airport", "New York", "US", 40.7772, -73.8726),
    ("EWR", "Newark Liberty International Airport", "Newark", "US", 40.6925, -74.1687),
    ("LAX", "Los Angeles International Airport", "Los Angeles", "US", 33.9425, -118.408),
    ("SFO", "San Francisco International Airport", "San Francisco", "US", 37.6213, -122.379),
    ("SEA", "Seattle-Tacoma International Airport", "Seattle", "US", 47.4502, -122.309),
    ("ORD", "O'Hare International Airport", "Chicago", "US", 41.9742, -87.9073),
    ("ATL", "Hartsfield-Jackson Atlanta International Airport", "Atlanta", "US", 33.6407, -84.4277),
    ("MIA", "Miami International Airport", "Miami", "US", 25.7959, -80.2870),
    ("BOS", "Logan International Airport", "Boston", "US", 42.3656, -71.0096),
    ("DFW", "Dallas/Fort Worth International Airport", "Dallas", "US", 32.8998, -97.0403),
    ("DEN", "Denver International Airport", "Denver", "US", 39.8561, -104.674),
    ("IAH", "George Bush Intercontinental Airport", "Houston", "US", 29.9902, -95.3368),
    ("PHX", "Phoenix Sky Harbor International Airport", "Phoenix", "US", 33.4373, -112.008),
    ("LAS", "Harry Reid International Airport", "Las Vegas", "US", 36.0840, -115.152),
    ("HNL", "Daniel K. Inouye International Airport", "Honolulu", "US", 21.3245, -157.925),
    ("ANC", "Ted Stevens Anchorage International Airport", "Anchorage", "US", 61.1744, -149.996),
    ("YVR", "Vancouver International Airport", "Vancouver", "CA", 49.1967, -123.184),
    ("YYZ", "Toronto Pearson International Airport", "Toronto", "CA", 43.6777, -79.6248),
    ("YUL", "Montréal-Trudeau International Airport", "Montreal", "CA", 45.4657, -73.7455),
    ("YYC", "Calgary International Airport", "Calgary", "CA", 51.1315, -114.011),
    # Latin America / Caribbean
    ("GRU", "São Paulo Guarulhos International Airport", "São Paulo", "BR", -23.4356, -46.4731),
    ("GIG", "Rio de Janeiro Galeão International Airport", "Rio de Janeiro", "BR", -22.8100, -43.2505),
    ("BSB", "Brasília International Airport", "Brasília", "BR", -15.8711, -47.9186),
    ("EZE", "Ministro Pistarini International Airport", "Buenos Aires", "AR", -34.8222, -58.5358),
    ("SCL", "Arturo Merino Benítez International Airport", "Santiago", "CL", -33.3930, -70.7858),
    ("BOG", "El Dorado International Airport", "Bogotá", "CO", 4.7016, -74.1469),
    ("LIM", "Jorge Chávez International Airport", "Lima", "PE", -12.0219, -77.1143),
    ("UIO", "Mariscal Sucre International Airport", "Quito", "EC", -0.1292, -78.3575),
    ("GUA", "La Aurora International Airport", "Guatemala City", "GT", 14.5833, -90.5275),
    ("MEX", "Mexico City International Airport", "Mexico City", "MX", 19.4363, -99.0721),
    ("CUN", "Cancún International Airport", "Cancún", "MX", 21.0365, -86.8771),
    ("NAS", "Lynden Pindling International Airport", "Nassau", "BS", 25.0390, -77.4662),
    ("MBJ", "Sangster International Airport", "Montego Bay", "JM", 18.5037, -77.9134),
    ("PUJ", "Punta Cana International Airport", "Punta Cana", "DO", 18.5674, -68.3634),
    # Pacific Islands
    ("PPT", "Tahiti Faa'a International Airport", "Papeete", "PF", -17.5534, -149.606),
    ("NAN", "Nadi International Airport", "Nadi", "FJ", -17.7554, 177.443),
    ("APW", "Faleolo International Airport", "Apia", "WS", -13.8300, -172.008),
    ("TBU", "Fua'amotu International Airport", "Nukuʻalofa", "TO", -21.2412, -175.150),
    ("GUM", "Antonio B. Won Pat International Airport", "Guam", "GU", 13.4834, 144.796),
    ("POM", "Jacksons International Airport", "Port Moresby", "PG", -9.4433, 147.220),
    ("HIR", "Honiara International Airport", "Honiara", "SB", -9.4280, 160.055),
    # Russia / Central Asia
    ("SVO", "Sheremetyevo International Airport", "Moscow", "RU", 55.9736, 37.4125),
    ("VKO", "Vnukovo International Airport", "Moscow", "RU", 55.5915, 37.2615),
    ("OVB", "Tolmachevo Airport", "Novosibirsk", "RU", 54.9625, 82.6507),
    ("ALA", "Almaty International Airport", "Almaty", "KZ", 43.3521, 77.0408),
    ("TAS", "Tashkent International Airport", "Tashkent", "UZ", 41.2579, 69.2812),
]
# fmt: on

# Build lookup indexes
_by_iata: dict[str, tuple] = {}
_by_city: dict[str, list[tuple]] = {}

for _row in AIRPORTS:
    _iata, _name, _city, _country, _lat, _lon = _row
    _by_iata[_iata.upper()] = _row
    _key = _city.lower()
    _by_city.setdefault(_key, []).append(_row)
    # Also index on first word of city (e.g. "new" for "New York")
    _by_city.setdefault(_key.split()[0], []).append(_row)


# ─── country macro database (2024 estimates) ─────────────────────────────────
# fmt: off
# (country_alpha2, gdp_usd_billions, population_millions, tourism_arrivals_millions_2019)
# GDP: IMF WEO April 2024; Pop: UN 2024; Tourism: UNWTO 2019
COUNTRY_MACRO: dict[str, dict] = {
    "AU": {"name": "Australia",         "gdp_b": 1757,  "pop_m": 27.2,   "tourism_m": 9.5},
    "NZ": {"name": "New Zealand",       "gdp_b": 260,   "pop_m": 5.3,    "tourism_m": 3.9},
    "SG": {"name": "Singapore",         "gdp_b": 547,   "pop_m": 6.0,    "tourism_m": 19.1},
    "MY": {"name": "Malaysia",          "gdp_b": 430,   "pop_m": 33.6,   "tourism_m": 26.1},
    "TH": {"name": "Thailand",          "gdp_b": 544,   "pop_m": 71.8,   "tourism_m": 39.8},
    "ID": {"name": "Indonesia",         "gdp_b": 1372,  "pop_m": 277.5,  "tourism_m": 16.1},
    "PH": {"name": "Philippines",       "gdp_b": 437,   "pop_m": 114.2,  "tourism_m": 8.3},
    "VN": {"name": "Vietnam",           "gdp_b": 476,   "pop_m": 98.2,   "tourism_m": 18.0},
    "MM": {"name": "Myanmar",           "gdp_b": 65,    "pop_m": 54.4,   "tourism_m": 4.4},
    "KH": {"name": "Cambodia",          "gdp_b": 31,    "pop_m": 17.4,   "tourism_m": 6.6},
    "LA": {"name": "Laos",              "gdp_b": 16,    "pop_m": 7.5,    "tourism_m": 4.8},
    "JP": {"name": "Japan",             "gdp_b": 4028,  "pop_m": 124.0,  "tourism_m": 31.9},
    "KR": {"name": "South Korea",       "gdp_b": 1713,  "pop_m": 51.7,   "tourism_m": 17.5},
    "CN": {"name": "China",             "gdp_b": 18530, "pop_m": 1412.0, "tourism_m": 65.7},
    "HK": {"name": "Hong Kong",         "gdp_b": 368,   "pop_m": 7.5,    "tourism_m": 55.9},
    "TW": {"name": "Taiwan",            "gdp_b": 756,   "pop_m": 23.6,   "tourism_m": 11.9},
    "IN": {"name": "India",             "gdp_b": 3568,  "pop_m": 1441.7, "tourism_m": 17.9},
    "LK": {"name": "Sri Lanka",         "gdp_b": 84,    "pop_m": 22.3,   "tourism_m": 1.9},
    "BD": {"name": "Bangladesh",        "gdp_b": 451,   "pop_m": 172.5,  "tourism_m": 0.3},
    "NP": {"name": "Nepal",             "gdp_b": 44,    "pop_m": 30.0,   "tourism_m": 1.2},
    "MV": {"name": "Maldives",          "gdp_b": 8,     "pop_m": 0.5,    "tourism_m": 1.7},
    "AE": {"name": "UAE",               "gdp_b": 509,   "pop_m": 10.0,   "tourism_m": 21.3},
    "QA": {"name": "Qatar",             "gdp_b": 219,   "pop_m": 3.0,    "tourism_m": 2.1},
    "SA": {"name": "Saudi Arabia",      "gdp_b": 1068,  "pop_m": 36.8,   "tourism_m": 17.5},
    "BH": {"name": "Bahrain",           "gdp_b": 44,    "pop_m": 1.7,    "tourism_m": 12.2},
    "KW": {"name": "Kuwait",            "gdp_b": 161,   "pop_m": 4.4,    "tourism_m": 0.3},
    "OM": {"name": "Oman",              "gdp_b": 108,   "pop_m": 4.5,    "tourism_m": 4.0},
    "JO": {"name": "Jordan",            "gdp_b": 51,    "pop_m": 10.3,   "tourism_m": 5.3},
    "LB": {"name": "Lebanon",           "gdp_b": 22,    "pop_m": 6.8,    "tourism_m": 1.9},
    "IL": {"name": "Israel",            "gdp_b": 509,   "pop_m": 9.7,    "tourism_m": 4.6},
    "TR": {"name": "Turkey",            "gdp_b": 1344,  "pop_m": 85.3,   "tourism_m": 51.2},
    "ZA": {"name": "South Africa",      "gdp_b": 380,   "pop_m": 60.1,   "tourism_m": 10.2},
    "KE": {"name": "Kenya",             "gdp_b": 116,   "pop_m": 54.0,   "tourism_m": 2.0},
    "ET": {"name": "Ethiopia",          "gdp_b": 156,   "pop_m": 123.4,  "tourism_m": 0.8},
    "NG": {"name": "Nigeria",           "gdp_b": 362,   "pop_m": 222.2,  "tourism_m": 2.0},
    "GH": {"name": "Ghana",             "gdp_b": 76,    "pop_m": 33.5,   "tourism_m": 1.1},
    "MA": {"name": "Morocco",           "gdp_b": 144,   "pop_m": 37.8,   "tourism_m": 13.1},
    "EG": {"name": "Egypt",             "gdp_b": 347,   "pop_m": 104.1,  "tourism_m": 13.1},
    "TN": {"name": "Tunisia",           "gdp_b": 48,    "pop_m": 12.0,   "tourism_m": 9.4},
    "DZ": {"name": "Algeria",           "gdp_b": 239,   "pop_m": 45.6,   "tourism_m": 2.4},
    "TZ": {"name": "Tanzania",          "gdp_b": 79,    "pop_m": 63.0,   "tourism_m": 1.5},
    "UG": {"name": "Uganda",            "gdp_b": 49,    "pop_m": 48.6,   "tourism_m": 1.5},
    "MU": {"name": "Mauritius",         "gdp_b": 15,    "pop_m": 1.3,    "tourism_m": 1.4},
    "GB": {"name": "United Kingdom",    "gdp_b": 3073,  "pop_m": 68.4,   "tourism_m": 39.4},
    "FR": {"name": "France",            "gdp_b": 3030,  "pop_m": 68.2,   "tourism_m": 89.4},
    "DE": {"name": "Germany",           "gdp_b": 4456,  "pop_m": 84.5,   "tourism_m": 39.6},
    "NL": {"name": "Netherlands",       "gdp_b": 1118,  "pop_m": 17.9,   "tourism_m": 20.1},
    "CH": {"name": "Switzerland",       "gdp_b": 906,   "pop_m": 8.9,    "tourism_m": 26.3},
    "ES": {"name": "Spain",             "gdp_b": 1583,  "pop_m": 47.9,   "tourism_m": 83.5},
    "IT": {"name": "Italy",             "gdp_b": 2255,  "pop_m": 58.8,   "tourism_m": 64.5},
    "AT": {"name": "Austria",           "gdp_b": 527,   "pop_m": 9.1,    "tourism_m": 40.0},
    "BE": {"name": "Belgium",           "gdp_b": 632,   "pop_m": 11.7,   "tourism_m": 9.9},
    "PT": {"name": "Portugal",          "gdp_b": 284,   "pop_m": 10.3,   "tourism_m": 27.1},
    "NO": {"name": "Norway",            "gdp_b": 544,   "pop_m": 5.5,    "tourism_m": 6.1},
    "SE": {"name": "Sweden",            "gdp_b": 593,   "pop_m": 10.5,   "tourism_m": 7.4},
    "DK": {"name": "Denmark",           "gdp_b": 404,   "pop_m": 5.9,    "tourism_m": 14.3},
    "FI": {"name": "Finland",           "gdp_b": 299,   "pop_m": 5.5,    "tourism_m": 3.5},
    "PL": {"name": "Poland",            "gdp_b": 811,   "pop_m": 38.0,   "tourism_m": 21.2},
    "CZ": {"name": "Czech Republic",    "gdp_b": 330,   "pop_m": 10.9,   "tourism_m": 21.3},
    "HU": {"name": "Hungary",           "gdp_b": 211,   "pop_m": 9.7,    "tourism_m": 16.9},
    "GR": {"name": "Greece",            "gdp_b": 240,   "pop_m": 10.4,   "tourism_m": 31.3},
    "IE": {"name": "Ireland",           "gdp_b": 532,   "pop_m": 5.1,    "tourism_m": 10.9},
    "RU": {"name": "Russia",            "gdp_b": 2021,  "pop_m": 143.5,  "tourism_m": 24.6},
    "KZ": {"name": "Kazakhstan",        "gdp_b": 261,   "pop_m": 19.8,   "tourism_m": 8.5},
    "UZ": {"name": "Uzbekistan",        "gdp_b": 103,   "pop_m": 36.0,   "tourism_m": 6.7},
    "US": {"name": "United States",     "gdp_b": 28781, "pop_m": 335.9,  "tourism_m": 79.3},
    "CA": {"name": "Canada",            "gdp_b": 2240,  "pop_m": 40.1,   "tourism_m": 22.1},
    "MX": {"name": "Mexico",            "gdp_b": 1789,  "pop_m": 129.4,  "tourism_m": 45.0},
    "BR": {"name": "Brazil",            "gdp_b": 2331,  "pop_m": 215.3,  "tourism_m": 6.4},
    "AR": {"name": "Argentina",         "gdp_b": 621,   "pop_m": 45.8,   "tourism_m": 7.4},
    "CL": {"name": "Chile",             "gdp_b": 344,   "pop_m": 19.6,   "tourism_m": 4.5},
    "CO": {"name": "Colombia",          "gdp_b": 363,   "pop_m": 51.9,   "tourism_m": 4.5},
    "PE": {"name": "Peru",              "gdp_b": 263,   "pop_m": 33.4,   "tourism_m": 4.4},
    "EC": {"name": "Ecuador",           "gdp_b": 119,   "pop_m": 18.2,   "tourism_m": 2.2},
    "GT": {"name": "Guatemala",         "gdp_b": 101,   "pop_m": 17.6,   "tourism_m": 2.0},
    "PF": {"name": "French Polynesia",  "gdp_b": 6,     "pop_m": 0.3,    "tourism_m": 0.2},
    "FJ": {"name": "Fiji",              "gdp_b": 5,     "pop_m": 0.9,    "tourism_m": 0.9},
    "WS": {"name": "Samoa",             "gdp_b": 1,     "pop_m": 0.2,    "tourism_m": 0.2},
    "TO": {"name": "Tonga",             "gdp_b": 0.5,   "pop_m": 0.1,    "tourism_m": 0.1},
    "GU": {"name": "Guam",              "gdp_b": 6,     "pop_m": 0.16,   "tourism_m": 1.6},
    "PG": {"name": "Papua New Guinea",  "gdp_b": 28,    "pop_m": 10.3,   "tourism_m": 0.2},
    "SB": {"name": "Solomon Islands",   "gdp_b": 2,     "pop_m": 0.7,    "tourism_m": 0.3},
    "BS": {"name": "Bahamas",           "gdp_b": 13,    "pop_m": 0.4,    "tourism_m": 7.1},
    "JM": {"name": "Jamaica",           "gdp_b": 19,    "pop_m": 2.8,    "tourism_m": 4.3},
    "DO": {"name": "Dominican Republic","gdp_b": 113,   "pop_m": 11.0,   "tourism_m": 6.4},
}
# fmt: on


# ─── public lookup functions ──────────────────────────────────────────────────

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points in kilometres."""
    R = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def lookup_airport(query: str) -> dict | None:
    """
    Find an airport by IATA code or city name (case-insensitive).
    Returns a dict with iata, name, city, country, lat, lon, distance_from_syd_km.
    """
    q = query.strip().upper()
    # Direct IATA match
    if q in _by_iata:
        row = _by_iata[q]
    else:
        # City name search (case-insensitive)
        matches = _by_city.get(q.lower()) or _by_city.get(q.lower().split()[0])
        if not matches:
            return None
        row = matches[0]

    iata, name, city, country, lat, lon = row
    dist = haversine_km(SYD_LAT, SYD_LON, lat, lon)
    return {
        "iata": iata,
        "name": name,
        "city": city,
        "country": country,
        "lat": lat,
        "lon": lon,
        "distance_from_syd_km": round(dist, 1),
        "macro": COUNTRY_MACRO.get(country),
    }


def search_airports(query: str, limit: int = 8) -> list[dict]:
    """
    Search airports by IATA or partial city/country name.
    Returns up to `limit` results sorted by relevance.
    """
    q = query.strip().lower()
    results = []

    for row in AIRPORTS:
        iata, name, city, country, lat, lon = row
        if q in iata.lower() or q in city.lower() or q in name.lower() or q in country.lower():
            dist = haversine_km(SYD_LAT, SYD_LON, lat, lon)
            results.append({
                "iata": iata,
                "name": name,
                "city": city,
                "country": country,
                "distance_from_syd_km": round(dist, 1),
            })

    return sorted(results, key=lambda r: r["distance_from_syd_km"])[:limit]


def get_country_macro(country_alpha2: str) -> dict | None:
    return COUNTRY_MACRO.get(country_alpha2.upper())
