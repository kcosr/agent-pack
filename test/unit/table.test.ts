import { describe, expect, it } from "vitest";
import { renderTable } from "../../src/cli/table.js";

describe("table rendering", () => {
  it("renders aligned columns with a header", () => {
    const rendered = renderTable(
      [
        { header: "ID", value: (row: { id: string; status: string }) => row.id },
        { header: "STATUS", value: (row) => row.status },
      ],
      [
        { id: "short", status: "pending" },
        { id: "much-longer", status: "completed" },
      ],
    );

    expect(rendered).toBe(
      ["ID           STATUS", "short        pending", "much-longer  completed", ""].join("\n"),
    );
  });

  it("renders a header for empty row sets", () => {
    expect(renderTable([{ header: "ID", value: () => "" }], [])).toBe("ID\n");
  });
});
