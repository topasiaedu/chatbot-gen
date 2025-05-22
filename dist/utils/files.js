"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextFromFileUrl = extractTextFromFileUrl;
const axios_1 = __importDefault(require("axios"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
const textract_1 = __importDefault(require("textract"));
const csv_parser_1 = __importDefault(require("csv-parser"));
const cheerio_1 = __importDefault(require("cheerio"));
const exceljs_1 = __importDefault(require("exceljs"));
// Helper function to download a file from a URL and save it to a temporary location
function downloadFileFromUrl(fileUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const fileName = path_1.default.basename(decodeURIComponent(fileUrl));
        const tempFilePath = path_1.default.join(os_1.default.tmpdir(), fileName);
        const response = yield (0, axios_1.default)({
            url: fileUrl,
            method: 'GET',
            responseType: 'stream',
        });
        const writer = fs_1.default.createWriteStream(tempFilePath);
        return new Promise((resolve, reject) => {
            response.data.pipe(writer);
            writer.on('finish', () => resolve(tempFilePath));
            writer.on('error', reject);
        });
    });
}
// Helper function to extract text from CSV files
function extractTextFromCSV(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            let content = "";
            fs_1.default.createReadStream(filePath)
                .pipe((0, csv_parser_1.default)())
                .on("data", (row) => {
                content += Object.values(row).join(", ") + "\n";
            })
                .on("end", () => {
                resolve(content);
            })
                .on("error", reject);
        });
    });
}
// Helper function to extract text from Excel files
function extractTextFromXLSX(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const workbook = new exceljs_1.default.Workbook();
        yield workbook.xlsx.readFile(filePath);
        let content = "";
        // Iterate through each worksheet
        workbook.eachSheet((worksheet, sheetId) => {
            // Add sheet name as a header
            content += `Sheet: ${worksheet.name}\n`;
            // Iterate through each row
            worksheet.eachRow((row, rowNumber) => {
                const rowValues = row.values;
                // Skip the first element as it's typically undefined in ExcelJS
                const filteredValues = rowValues.filter((val, index) => index > 0 && val !== undefined);
                if (filteredValues.length) {
                    content += filteredValues.join(", ") + "\n";
                }
            });
            content += "\n"; // Add separation between sheets
        });
        return content;
    });
}
// Helper function to extract text from TXT files
function extractTextFromTXT(filePath) {
    return fs_1.default.readFileSync(filePath, "utf8");
}
// Helper function to extract text from HTML files
function extractTextFromHTML(filePath) {
    const htmlContent = fs_1.default.readFileSync(filePath, "utf8");
    const $ = cheerio_1.default.load(htmlContent);
    return $.text(); // Extract visible text from the HTML content
}
// Helper function to extract text from DOCX files
function extractTextFromDOCX(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const result = yield mammoth_1.default.extractRawText({ path: filePath });
        return result.value;
    });
}
// Helper function to extract text from PDF files
function extractTextFromPDF(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        const dataBuffer = fs_1.default.readFileSync(filePath);
        const pdfData = yield (0, pdf_parse_1.default)(dataBuffer);
        return pdfData.text;
    });
}
// Helper function to extract text from PPTX files
function extractTextFromPPTX(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            textract_1.default.fromFileWithPath(filePath, (error, text) => {
                if (error) {
                    reject(new Error(`Error extracting text from PPTX: ${error.message}`));
                }
                else {
                    resolve(text);
                }
            });
        });
    });
}
// Main function to handle remote file URLs and extract text based on file type
function extractTextFromFileUrl(fileUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const tempFilePath = yield downloadFileFromUrl(fileUrl); // Step 1: Download the file
        const ext = path_1.default.extname(tempFilePath).toLowerCase();
        try {
            // Step 2: Extract text based on file type
            let extractedText;
            switch (ext) {
                case ".csv":
                    extractedText = yield extractTextFromCSV(tempFilePath);
                    break;
                case ".xlsx":
                case ".xls":
                    extractedText = yield extractTextFromXLSX(tempFilePath);
                    break;
                case ".txt":
                    extractedText = extractTextFromTXT(tempFilePath);
                    break;
                case ".html":
                    extractedText = extractTextFromHTML(tempFilePath);
                    break;
                case ".docx":
                    extractedText = yield extractTextFromDOCX(tempFilePath);
                    break;
                case ".pdf":
                    extractedText = yield extractTextFromPDF(tempFilePath);
                    break;
                case ".pptx":
                    extractedText = yield extractTextFromPPTX(tempFilePath);
                    break;
                default:
                    throw new Error(`Unsupported file format: ${ext}`);
            }
            return extractedText;
        }
        catch (error) {
            throw new Error(`Failed to extract text from file ${fileUrl}: ${error.message}`);
        }
        finally {
            // Step 3: Clean up the temporary file
            if (fs_1.default.existsSync(tempFilePath)) {
                fs_1.default.unlinkSync(tempFilePath);
            }
        }
    });
}
