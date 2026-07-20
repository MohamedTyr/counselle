import {
  DOCUMENT_STATUS_LABEL,
  documentStatusMessage,
} from "@/features/profile/document-status";

// Honesty-critical (AGENTS.md principle 3 / plan Part B): a document
// Counselle could not read must never be presented as though it were read.
describe("document status honesty", () => {
  it("never labels a failed extraction as readable", () => {
    expect(DOCUMENT_STATUS_LABEL.failed).not.toBe("Readable");
    expect(documentStatusMessage("failed")).toMatch(/couldn't|can't/i);
    expect(documentStatusMessage("failed")).not.toMatch(/counselle can read/i);
  });

  it("never labels an unsupported file as readable", () => {
    expect(DOCUMENT_STATUS_LABEL.unsupported).not.toBe("Readable");
    expect(documentStatusMessage("unsupported")).toMatch(/can't read/i);
    expect(documentStatusMessage("unsupported")).not.toMatch(
      /^counselle can read/i,
    );
  });

  it("only the extracted status claims readable content", () => {
    expect(DOCUMENT_STATUS_LABEL.extracted).toBe("Readable");
    expect(documentStatusMessage("extracted")).toMatch(/can read/i);
  });

  it("gives every status a distinct, honest label", () => {
    const labels = Object.values(DOCUMENT_STATUS_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
