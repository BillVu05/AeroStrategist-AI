/** Hands the browser a generated file. The one place the blob dance lives. */
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Save-as-PDF via the browser's own print dialog - see the @media print rules
 *  in globals.css, which strip the app chrome from the printed page. */
export function printPage() {
  window.print();
}
