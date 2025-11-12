# TOON Visualizer

**TOON Visualizer** is a web-based tool for parsing and visualizing **TOON (Token-Oriented Object Notation)** data structures.
It converts TOON syntax into a structured, interactive view that makes nested objects and arrays easy to explore.

---

## What is TOON

**TOON (Token-Oriented Object Notation)** is a lightweight, human-friendly structured data format — similar to YAML or TOML, but designed for clarity and compactness.
It supports nested objects, arrays (both tabular and list-based), and typed values such as booleans, nulls, numbers, and strings.

Learn more about TOON here:
[TOON on GitHub](https://github.com/toon-format/toon)

---

## Features

- Parse and visualize TOON data directly in the browser.
- Expand or collapse nested sections interactively.
- Detect invalid TOON structures with detailed error messages.
- Display statistics about parsed data (sections, arrays, fields, rows).
- Load an example TOON snippet with one click.
- Works entirely offline — no backend or build tools required.

---

## Usage

### Live Preview

You can access the online version here:
[TOON Visualizer Preview](https://mahmoudalnkeeb.github.io/toon-visualizer)

### Preview

<p align="center">
  <img src="./assets/preview.png" alt="TOON Visualizer Screenshot" width="700"/>
  <br/>
  <em>Figure 1: TOON Visualizer interface displaying parsed TOON data.</em>
</p>

### Local Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/mahmoudalnkeeb/toon-visualizer.git
   ```

2. Navigate into the project directory:

   ```bash
   cd toon-visualizer
   ```

3. Open `index.html` in your browser.

### How to Use

1. Paste or type TOON data into the input area.
2. Click **Visualize** to parse and render the structure.
3. Use the toolbar to:
   - **Expand All / Collapse All** – toggle all sections.
   - **Clear** – reset the interface.
   - **Example** – load a predefined TOON snippet.

All functionality runs entirely client-side using pure HTML, CSS, and JavaScript.

---

## Core Classes

| Class            | Description                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| `ToonParser`     | Parses TOON input into structured JSON-like data, handling validation, arrays, and nested objects. |
| `ToonRenderer`   | Renders the parsed structure into collapsible HTML sections and tables.                            |
| `ToonVisualizer` | Manages UI interactions, event handling, and rendering control.                                    |
| `ToonParseError` | Provides detailed parsing diagnostics and error handling.                                          |

---

## Statistics

After parsing, the application displays:

- **Sections** – number of top-level groups or objects
- **Arrays** – number of arrays detected
- **Fields** – total number of fields parsed
- **Rows** – total number of array entries

---

## License

This project is licensed under the [MIT License](LICENSE).
