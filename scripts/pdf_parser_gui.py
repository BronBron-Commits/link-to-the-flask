"""Small local GUI for testing PDF parser outputs on Windows.

Run from repo root:
    python scripts/pdf_parser_gui.py
"""

from __future__ import annotations

import io
import json
import os
import threading
import traceback
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox
from tkinter.scrolledtext import ScrolledText

try:
    from scripts import pdf_to_tidy_data
except Exception:
    import pdf_to_tidy_data  # type: ignore[no-redef]


class ParserGui(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("PDF Parser Tester")
        self.geometry("920x620")
        self.minsize(760, 520)

        self.pdf_path_var = tk.StringVar()
        self.out_dir_var = tk.StringVar(value=str(Path("data") / "character_tidy"))
        self.open_dir_var = tk.BooleanVar(value=True)
        self.status_var = tk.StringVar(value="Ready")

        self._build_ui()

    def _build_ui(self) -> None:
        root = tk.Frame(self, padx=12, pady=12)
        root.pack(fill="both", expand=True)

        row1 = tk.Frame(root)
        row1.pack(fill="x", pady=(0, 8))
        tk.Label(row1, text="PDF file", width=12, anchor="w").pack(side="left")
        tk.Entry(row1, textvariable=self.pdf_path_var).pack(side="left", fill="x", expand=True)
        tk.Button(row1, text="Browse", width=10, command=self._pick_pdf).pack(side="left", padx=(8, 0))

        row2 = tk.Frame(root)
        row2.pack(fill="x", pady=(0, 8))
        tk.Label(row2, text="Output dir", width=12, anchor="w").pack(side="left")
        tk.Entry(row2, textvariable=self.out_dir_var).pack(side="left", fill="x", expand=True)
        tk.Button(row2, text="Browse", width=10, command=self._pick_out_dir).pack(side="left", padx=(8, 0))

        row3 = tk.Frame(root)
        row3.pack(fill="x", pady=(0, 10))
        tk.Checkbutton(
            row3,
            text="Open output folder when finished",
            variable=self.open_dir_var,
            onvalue=True,
            offvalue=False,
        ).pack(side="left")

        row4 = tk.Frame(root)
        row4.pack(fill="x", pady=(0, 10))
        self.run_btn = tk.Button(row4, text="Run Parser", width=14, command=self._run_parser)
        self.run_btn.pack(side="left")
        tk.Button(row4, text="Clear Log", width=14, command=self._clear_log).pack(side="left", padx=(8, 0))
        tk.Label(row4, textvariable=self.status_var, fg="#1f4f99").pack(side="left", padx=(14, 0))

        tk.Label(root, text="Parser log and result", anchor="w").pack(fill="x")
        self.log = ScrolledText(root, wrap="word", height=25)
        self.log.pack(fill="both", expand=True)
        self._append_log("Select a PDF and click Run Parser.\n")

    def _pick_pdf(self) -> None:
        path = filedialog.askopenfilename(
            title="Choose D&D PDF",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
        )
        if path:
            self.pdf_path_var.set(path)

    def _pick_out_dir(self) -> None:
        path = filedialog.askdirectory(title="Choose output directory")
        if path:
            self.out_dir_var.set(path)

    def _set_running(self, running: bool) -> None:
        if running:
            self.run_btn.config(state="disabled")
            self.status_var.set("Running parser...")
        else:
            self.run_btn.config(state="normal")
            if self.status_var.get() == "Running parser...":
                self.status_var.set("Ready")

    def _clear_log(self) -> None:
        self.log.delete("1.0", tk.END)

    def _append_log(self, text: str) -> None:
        self.log.insert(tk.END, text)
        self.log.see(tk.END)

    def _run_parser(self) -> None:
        pdf_path = Path(self.pdf_path_var.get().strip())
        out_dir = Path(self.out_dir_var.get().strip())

        if not pdf_path.exists() or pdf_path.suffix.lower() != ".pdf":
            messagebox.showerror("Invalid PDF", "Choose an existing .pdf file.")
            return
        if not str(out_dir):
            messagebox.showerror("Invalid Output Directory", "Choose an output directory.")
            return

        self._append_log("\n" + "=" * 72 + "\n")
        self._append_log(f"Input: {pdf_path}\nOutput: {out_dir}\n")
        self._set_running(True)

        worker = threading.Thread(target=self._run_parser_worker, args=(pdf_path, out_dir), daemon=True)
        worker.start()

    def _run_parser_worker(self, pdf_path: Path, out_dir: Path) -> None:
        stream = io.StringIO()
        try:
            with redirect_stdout(stream), redirect_stderr(stream):
                tables = pdf_to_tidy_data.parse_character_tables(pdf_path)
                pdf_to_tidy_data.write_outputs(out_dir, tables)

            summary = {
                "ok": True,
                "name": tables.get("character", {}).get("name"),
                "character_id": tables.get("character", {}).get("character_id"),
                "out_dir": str(out_dir),
                "ability_scores": len(tables.get("ability_scores") or []),
                "features": len(tables.get("features") or []),
                "inventory_items": len(tables.get("inventory_items") or []),
                "spells": len(tables.get("spells") or []),
            }
            output = stream.getvalue()
            self.after(0, self._on_success, output, summary)
        except Exception:
            output = stream.getvalue()
            err = traceback.format_exc()
            self.after(0, self._on_error, output, err)

    def _on_success(self, parser_log: str, summary: dict) -> None:
        if parser_log:
            self._append_log(parser_log + "\n")

        self._append_log("Run completed successfully.\n")
        self._append_log(json.dumps(summary, indent=2) + "\n")
        self.status_var.set("Completed")
        self._set_running(False)

        if self.open_dir_var.get():
            try:
                os.startfile(summary["out_dir"])  # type: ignore[attr-defined]
            except Exception:
                pass

    def _on_error(self, parser_log: str, error_text: str) -> None:
        if parser_log:
            self._append_log(parser_log + "\n")
        self._append_log("Parser run failed.\n")
        self._append_log(error_text + "\n")
        self.status_var.set("Failed")
        self._set_running(False)
        messagebox.showerror("Parser Failed", "See the log area for details.")


def main() -> None:
    app = ParserGui()
    app.mainloop()


if __name__ == "__main__":
    main()
