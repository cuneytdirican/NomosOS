/**
 * İ-64: pdf-parse@1.1.1'in ana girişi (`index.js`) `module.parent` tanımsızken
 * (ESM dinamik import'ta hep tanımsızdir) DEBUG moduna geçip diskteki test
 * PDF'ini okumaya çalışır. Bu yüzden doğrudan `lib/pdf-parse.js` girişi
 * kullanılır; bu bildirim o girişin tipini tanımlar.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    text: string;
    version: string;
  }
  function pdfParse(
    buffer: Buffer,
    options?: { max?: number; pagerender?: (page: unknown) => Promise<string> },
  ): Promise<PdfParseResult>;
  export default pdfParse;
}
