import fs from 'fs-extra';
import pdfParse from 'pdf-parse';
import { extractPDFInfo } from './aiService.js';
import { savePDFRecord } from './memoryService.js';

export const processPDF = async (filePath, originalName) => {
    try {
        const dataBuffer = await fs.readFile(filePath);
        const data = await pdfParse(dataBuffer);

        const extractedText = data.text;

        // Use AI to extract structured info
        const info = await extractPDFInfo(extractedText);

        const record = {
            id: Date.now().toString(),
            filename: originalName,
            summary: info.summary,
            entities: info.entities,
            actionItems: info.actionItems,
            uploadDate: new Date().toISOString()
        };

        // Save to SQLite
        savePDFRecord(record);

        // Cleanup temp file
        await fs.remove(filePath);

        return record;
    } catch (error) {
        console.error("Error processing PDF:", error);
        throw error;
    }
};