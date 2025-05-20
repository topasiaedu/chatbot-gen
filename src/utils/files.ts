import axios from "axios";
import fs from "fs";
import path from "path";
import os from "os";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import textract from "textract";
import csvParser from "csv-parser";
import cheerio from "cheerio";
import ExcelJS from "exceljs";

// Helper function to download a file from a URL and save it to a temporary location
async function downloadFileFromUrl(fileUrl: string): Promise<string> {
  const fileName = path.basename(decodeURIComponent(fileUrl));
  const tempFilePath = path.join(os.tmpdir(), fileName);

  const response = await axios({
    url: fileUrl,
    method: 'GET',
    responseType: 'stream',
  });

  const writer = fs.createWriteStream(tempFilePath);
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', () => resolve(tempFilePath));
    writer.on('error', reject);
  });
}

// Helper function to extract text from CSV files
async function extractTextFromCSV(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let content = "";
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on("data", (row) => {
        content += Object.values(row).join(", ") + "\n";
      })
      .on("end", () => {
        resolve(content);
      })
      .on("error", reject);
  });
}

// Helper function to extract text from Excel files
async function extractTextFromXLSX(filePath: string): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  let content = "";
  
  // Iterate through each worksheet
  workbook.eachSheet((worksheet, sheetId) => {
    // Add sheet name as a header
    content += `Sheet: ${worksheet.name}\n`;
    
    // Iterate through each row
    worksheet.eachRow((row, rowNumber) => {
      const rowValues = row.values as any[];
      // Skip the first element as it's typically undefined in ExcelJS
      const filteredValues = rowValues.filter((val, index) => index > 0 && val !== undefined);
      if (filteredValues.length) {
        content += filteredValues.join(", ") + "\n";
      }
    });
    
    content += "\n"; // Add separation between sheets
  });
  
  return content;
}

// Helper function to extract text from TXT files
function extractTextFromTXT(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

// Helper function to extract text from HTML files
function extractTextFromHTML(filePath: string): string {
  const htmlContent = fs.readFileSync(filePath, "utf8");
  const $ = cheerio.load(htmlContent);
  return $.text(); // Extract visible text from the HTML content
}

// Helper function to extract text from DOCX files
async function extractTextFromDOCX(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

// Helper function to extract text from PDF files
async function extractTextFromPDF(filePath: string): Promise<string> {
  const dataBuffer = fs.readFileSync(filePath);
  const pdfData = await pdfParse(dataBuffer);
  return pdfData.text;
}

// Helper function to extract text from PPTX files
async function extractTextFromPPTX(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    textract.fromFileWithPath(filePath, (error, text) => {
      if (error) {
        reject(new Error(`Error extracting text from PPTX: ${error.message}`));
      } else {
        resolve(text);
      }
    });
  });
}

// Main function to handle remote file URLs and extract text based on file type
export async function extractTextFromFileUrl(fileUrl: string): Promise<string> {
  const tempFilePath = await downloadFileFromUrl(fileUrl); // Step 1: Download the file
  const ext = path.extname(tempFilePath).toLowerCase();

  try {
    // Step 2: Extract text based on file type
    let extractedText;
    switch (ext) {
      case ".csv":
        extractedText = await extractTextFromCSV(tempFilePath);
        break;
      case ".xlsx":
      case ".xls":
        extractedText = await extractTextFromXLSX(tempFilePath);
        break;
      case ".txt":
        extractedText = extractTextFromTXT(tempFilePath);
        break;
      case ".html":
        extractedText = extractTextFromHTML(tempFilePath);
        break;
      case ".docx":
        extractedText = await extractTextFromDOCX(tempFilePath);
        break;
      case ".pdf":
        extractedText = await extractTextFromPDF(tempFilePath);
        break;
      case ".pptx":
        extractedText = await extractTextFromPPTX(tempFilePath);
        break;
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
    return extractedText;
  } catch (error) {
    throw new Error(`Failed to extract text from file ${fileUrl}: ${(error as any).message}`);
  } finally {
    // Step 3: Clean up the temporary file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}
