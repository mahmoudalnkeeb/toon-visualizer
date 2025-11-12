class ToonParser {
  constructor() {
    this.defaultDelimiter = ",";
    this.indentSize = 2;
  }

  parse(input) {
    this.validateInput(input);
    const lines = this.parseLines(input);
    const data = this.decode(lines);
    const stats = this.computeStats(data);

    return {
      data: this.normalizeValue(data),
      stats,
    };
  }

  validateInput(input) {
    if (typeof input !== "string") {
      throw new ToonParseError("Input must be a string");
    }
    if (!input.trim()) {
      throw new ToonParseError("Input cannot be empty");
    }
  }

  parseLines(input) {
    return input.split("\n").map((raw, index) => {
      const leadingSpaces = raw.match(/^ */)[0].length;
      const depth = Math.floor(leadingSpaces / this.indentSize);
      const trimmed = raw.trim();

      return {
        raw,
        depth,
        content: trimmed,
        lineNum: index + 1,
        isBlank: trimmed === "",
        originalIndent: raw.substring(0, raw.length - trimmed.length),
      };
    });
  }

  decode(lines) {
    const nonBlankLines = lines.filter((line) => !line.isBlank);

    if (nonBlankLines.length === 0) return {};

    const firstLine = nonBlankLines[0];
    const headerInfo = this.parseHeader(firstLine.content);

    if (headerInfo && headerInfo.key === null) {
      return this.decodeArray(lines, 0, headerInfo);
    }

    if (nonBlankLines.length === 1) {
      try {
        this.splitKeyValue(firstLine.content);
      } catch {
        return this.parsePrimitive(firstLine.content);
      }
    }

    return this.decodeObject(lines, 0, -1);
  }

  decodeObject(lines, startIdx, parentDepth) {
    const result = {};
    let i = startIdx;
    const expectedDepth = parentDepth + 1;

    while (i < lines.length) {
      const line = lines[i];

      if (line.isBlank) {
        i++;
        continue;
      }

      if (line.depth < expectedDepth && expectedDepth > 0) break;
      if (line.depth > expectedDepth) {
        i++;
        continue;
      }

      const headerInfo = this.parseHeader(line.content);
      if (headerInfo?.key) {
        const arrayValue = this.decodeArray(lines, i, headerInfo);
        result[headerInfo.key] = arrayValue.value;
        i = arrayValue.nextIndex;
        continue;
      }

      try {
        const { key, value } = this.splitKeyValue(line.content);
        const parsedKey = this.parseKey(key);

        if (!this.isValidSnakeCase(parsedKey)) {
          throw new ToonParseError(
            `Key '${parsedKey}' must use snake_case format`,
            line.lineNum,
          );
        }

        if (!value) {
          const nestedContent = this.collectNestedLines(
            lines,
            i + 1,
            line.depth,
          );
          result[parsedKey] =
            nestedContent.length > 0
              ? this.decodeObject(nestedContent, 0, line.depth)
              : {};
          i += nestedContent.length + 1;
        } else {
          result[parsedKey] = this.parsePrimitive(value);
          i++;
        }
      } catch (error) {
        throw new ToonParseError(
          `Invalid object structure: ${error.message}`,
          line.lineNum,
        );
      }
    }

    return result;
  }

  decodeArray(lines, startIdx, headerInfo) {
    const { key, length, delimiter, fields } = headerInfo;
    const headerLine = lines[startIdx];

    const colonIndex = headerLine.content.indexOf(":");
    if (colonIndex !== -1) {
      const afterColon = headerLine.content.substring(colonIndex + 1).trim();

      if (afterColon) {
        const values = this.parseDelimitedValues(afterColon, delimiter);

        this.validateArrayLength(values.length, length, headerLine.lineNum);

        return {
          value: values.map((val) => this.parsePrimitive(val)),
          nextIndex: startIdx + 1,
        };
      }
    }

    if (fields) {
      return this.decodeTabularArray(
        lines,
        startIdx + 1,
        headerLine.depth,
        fields,
        delimiter,
        length,
      );
    } else {
      return this.decodeListArray(
        lines,
        startIdx + 1,
        headerLine.depth,
        delimiter,
        length,
      );
    }
  }

  decodeTabularArray(
    lines,
    startIdx,
    headerDepth,
    fields,
    delimiter,
    expectedLength,
  ) {
    const result = [];
    let i = startIdx;
    const rowDepth = headerDepth + 1;

    while (i < lines.length) {
      const line = lines[i];

      if (line.isBlank) {
        i++;
        continue;
      }

      if (line.depth <= headerDepth) break;

      if (line.depth === rowDepth) {
        const values = this.parseDelimitedValues(line.content, delimiter);

        if (values.length !== fields.length) {
          throw new ToonParseError(
            `Row has ${values.length} values but header expects ${fields.length} fields: ${fields.join(", ")}`,
            line.lineNum,
          );
        }

        const row = this.createTableRow(fields, values);
        result.push(row);
        i++;
      } else {
        i++;
      }
    }

    this.validateArrayLength(
      result.length,
      expectedLength,
      lines[startIdx - 1]?.lineNum || startIdx,
    );
    return { value: result, nextIndex: i };
  }

  decodeListArray(lines, startIdx, headerDepth, delimiter, expectedLength) {
    const result = [];
    let i = startIdx;
    const itemDepth = headerDepth + 1;

    while (i < lines.length) {
      const line = lines[i];

      if (line.isBlank) {
        i++;
        continue;
      }

      if (line.depth < itemDepth) break;
      if (line.depth > itemDepth) {
        i++;
        continue;
      }

      if (line.content.startsWith("- ")) {
        const itemContent = line.content.substring(2).trim();
        result.push(this.parsePrimitive(itemContent));
        i++;
      } else {
        const itemLines = this.collectNestedLines(lines, i, headerDepth);
        const itemResult = this.decodeObject(itemLines, 0, headerDepth);
        result.push(itemResult);
        i += itemLines.length;
      }
    }

    this.validateArrayLength(
      result.length,
      expectedLength,
      lines[startIdx]?.lineNum,
    );
    return { value: result, nextIndex: i };
  }

  parseDelimitedValues(content, delimiter = this.defaultDelimiter) {
    if (!content.trim()) return [];

    const values = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = null;
    let escapeNext = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escapeNext) {
        current += char;
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (inQuotes) {
        if (char === quoteChar) {
          inQuotes = false;
        }
        current += char;
      } else {
        if (
          (char === '"' || char === "'") &&
          (i === 0 || content[i - 1] !== "\\")
        ) {
          inQuotes = true;
          quoteChar = char;
          current += char;
        } else if (char === delimiter) {
          values.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
    }

    if (current.trim() !== "") {
      values.push(current.trim());
    }

    return values;
  }

  parsePrimitive(token) {
    if (token === null || token === undefined) return null;

    const trimmed = String(token).trim();
    if (trimmed === "") return null;

    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null" || trimmed === "nil") return null;

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      const unquoted = trimmed.slice(1, -1);
      return unquoted.replace(/\\(.)/g, "$1");
    }

    if (!isNaN(trimmed) && trimmed !== "" && !/^[a-zA-Z]/.test(trimmed)) {
      const num = Number(trimmed);
      if (!isNaN(num)) return num;
    }

    return trimmed;
  }

  findUnquotedChar(str, char, startIndex = 0) {
    let inQuotes = false;
    let quoteChar = null;
    let escapeNext = false;

    for (let i = startIndex; i < str.length; i++) {
      const currentChar = str[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (currentChar === "\\") {
        escapeNext = true;
        continue;
      }

      if (inQuotes) {
        if (currentChar === quoteChar) inQuotes = false;
      } else {
        if (currentChar === '"' || currentChar === "'") {
          inQuotes = true;
          quoteChar = currentChar;
        } else if (currentChar === char) {
          return i;
        }
      }
    }
    return -1;
  }

  parseKey(keyStr) {
    const trimmed = keyStr.trim();

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
    }

    return trimmed;
  }

  splitKeyValue(line) {
    const colonIdx = this.findUnquotedChar(line, ":");
    if (colonIdx === -1) {
      throw new ToonParseError("Missing colon after key");
    }

    return {
      key: line.substring(0, colonIdx).trim(),
      value: line.substring(colonIdx + 1).trim(),
    };
  }

  collectNestedLines(lines, startIdx, parentDepth) {
    const nestedLines = [];
    let i = startIdx;

    while (i < lines.length && lines[i].depth > parentDepth) {
      nestedLines.push(lines[i]);
      i++;
    }

    return nestedLines;
  }

  createTableRow(fields, values) {
    const row = {};
    fields.forEach((field, index) => {
      row[field] =
        values[index] !== undefined ? this.parsePrimitive(values[index]) : null;
    });
    return row;
  }

  normalizeValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return value;

    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeValue(item));
    }

    if (typeof value === "object") {
      const normalized = {};
      for (const [k, v] of Object.entries(value)) {
        normalized[k] = this.normalizeValue(v);
      }
      return normalized;
    }

    return String(value);
  }

  computeStats(data) {
    let sections = 0;
    let arrays = 0;
    let fields = 0;
    let rows = 0;

    const traverse = (obj) => {
      if (Array.isArray(obj)) {
        arrays++;
        rows += obj.length;
        obj.forEach((item) => {
          if (typeof item === "object" && item !== null) {
            traverse(item);
          }
        });
      } else if (typeof obj === "object" && obj !== null) {
        const keys = Object.keys(obj);
        if (keys.length > 0) sections++;
        fields += keys.length;
        keys.forEach((key) => traverse(obj[key]));
      }
    };

    traverse(data);
    return { sections, arrays, fields, rows };
  }

  isValidSnakeCase(key) {
    return /^[a-z][a-z0-9_]*(_[a-z0-9]+)*$/.test(key);
  }

  validateArrayLength(actual, expected, lineNum) {
    if (expected !== null && actual !== expected) {
      throw new ToonParseError(
        `Array length mismatch: declared [${expected}] but found ${actual} items`,
        lineNum,
      );
    }
  }

  parseHeader(line) {
    const bracketMatch = line.match(/^([^:\[]*)(\[([^\]]+)\])?(\{([^}]+)\})?/);
    if (!bracketMatch) return null;

    const keyPart = bracketMatch[1].trim();
    const bracketContent = bracketMatch[3];
    const fieldsContent = bracketMatch[5];

    if (!bracketContent) return null;

    const key = keyPart || null;
    let { length, delimiter } = this.parseBracketContent(bracketContent);

    if (length === null) return null;

    let fields = null;
    if (fieldsContent) {
      const fieldTokens = fieldsContent
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f);

      fieldTokens.forEach((field) => {
        if (!this.isValidSnakeCase(field)) {
          throw new ToonParseError(
            `Field name '${field}' must use snake_case format`,
          );
        }
      });

      fields = fieldTokens;

      if (delimiter === null) {
        delimiter = ",";
      }
    }

    if (delimiter === null) {
      delimiter = ",";
    }

    return { key, length, delimiter, fields };
  }

  parseBracketContent(content) {
    let lengthStr = content.trim();
    let delimiter = null;

    if (lengthStr.endsWith("|")) {
      delimiter = "|";
      lengthStr = lengthStr.slice(0, -1);
    } else if (lengthStr.endsWith(",")) {
      delimiter = ",";
      lengthStr = lengthStr.slice(0, -1);
    }

    if (lengthStr.startsWith("#")) {
      lengthStr = lengthStr.substring(1);
    }

    try {
      const length = parseInt(lengthStr);
      return isNaN(length)
        ? { length: null, delimiter }
        : { length, delimiter };
    } catch {
      return { length: null, delimiter };
    }
  }
}

class ToonParseError extends Error {
  constructor(message, lineNumber = null) {
    super(lineNumber ? `Line ${lineNumber}: ${message}` : message);
    this.name = "ToonParseError";
    this.lineNumber = lineNumber;
  }
}

class ToonRenderer {
  constructor() {
    this.allExpanded = false;
  }

  render(data, container, stats) {
    container.innerHTML = "";

    if (!data || Object.keys(data).length === 0) {
      this.renderEmptyState(container);
      return;
    }

    Object.entries(data).forEach(([key, value]) => {
      const section = this.createSection(key, value);
      if (section) container.appendChild(section);
    });

    this.renderStats(stats);
    this.updateExpandAllButton();
  }

  createSection(key, value, path = "") {
    const section = document.createElement("div");
    section.className = "toon-section";

    const { meta, isCollapsible } = this.getSectionMeta(value);
    const header = this.createHeader(key, meta, isCollapsible);
    const content = this.createContent(key, value, path, isCollapsible);

    if (isCollapsible) {
      this.makeCollapsible(header, content);
      section.appendChild(header);
    }

    section.appendChild(content);
    if (!isCollapsible) content.classList.add("show");

    return section;
  }

  getSectionMeta(value) {
    if (Array.isArray(value)) {
      const isTabular =
        value.length > 0 &&
        value.every((item) => typeof item === "object" && item !== null);

      if (isTabular) {
        const allKeys = new Set(value.flatMap((item) => Object.keys(item)));
        return {
          meta: `[${value.length}] rows × ${allKeys.size} fields`,
          isCollapsible: true,
        };
      }
      return {
        meta: `[${value.length}] items`,
        isCollapsible: true,
      };
    }

    if (typeof value === "object" && value !== null) {
      const fieldCount = Object.keys(value).length;
      return {
        meta: `${fieldCount} field${fieldCount !== 1 ? "s" : ""}`,
        isCollapsible: true,
      };
    }

    return { meta: "", isCollapsible: false };
  }

  createHeader(key, meta, isCollapsible) {
    const header = document.createElement("div");
    header.className = "section-header";

    header.innerHTML = `
            <div>
                <span class="section-name">${key}</span>
                ${meta ? `<span class="section-meta">${meta}</span>` : ""}
            </div>
            ${isCollapsible ? '<span class="toggle-icon">▼</span>' : ""}
        `;

    return header;
  }

  createContent(key, value, path, isCollapsible) {
    const content = document.createElement("div");
    content.className = `section-content ${isCollapsible ? "" : "show"}`;

    if (Array.isArray(value)) {
      content.appendChild(this.renderArray(value));
    } else if (typeof value === "object" && value !== null) {
      content.appendChild(this.renderObject(value, path, key));
    } else {
      return this.renderField(key, value);
    }

    return content;
  }

  renderArray(array) {
    const isTabular =
      array.length > 0 &&
      array.every((item) => typeof item === "object" && item !== null);

    if (isTabular) {
      return this.renderTabularArray(array);
    } else {
      return this.renderSimpleArray(array);
    }
  }

  renderTabularArray(array) {
    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";

    const table = document.createElement("table");
    const allKeys = Array.from(
      new Set(array.flatMap((item) => Object.keys(item))),
    );

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = '<th style="width: 40px;">#</th>';

    allKeys.forEach((field) => {
      const th = document.createElement("th");
      th.textContent = field;
      headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    array.forEach((item, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td class="row-number">${index + 1}</td>`;

      allKeys.forEach((field) => {
        const td = document.createElement("td");
        const fieldValue = item[field];
        td.textContent =
          fieldValue !== undefined && fieldValue !== null
            ? String(fieldValue)
            : "null";
        row.appendChild(td);
      });

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    return tableWrapper;
  }

  renderSimpleArray(array) {
    const arrayDiv = document.createElement("div");
    arrayDiv.className = "array-container";

    array.forEach((item, index) => {
      const fieldItem = document.createElement("div");
      fieldItem.className = "field-item";
      fieldItem.innerHTML = `
                <span class="field-key">${index}</span>
                <span class="field-value">${JSON.stringify(item)}</span>
            `;
      arrayDiv.appendChild(fieldItem);
    });

    return arrayDiv;
  }

  renderObject(obj, path, parentKey) {
    const container = document.createElement("div");

    Object.entries(obj).forEach(([nestedKey, nestedValue]) => {
      if (
        Array.isArray(nestedValue) ||
        (typeof nestedValue === "object" && nestedValue !== null)
      ) {
        const nestedSection = this.createSection(
          nestedKey,
          nestedValue,
          path ? `${path}.${nestedKey}` : parentKey,
        );
        container.appendChild(nestedSection);
      } else {
        container.appendChild(this.renderField(nestedKey, nestedValue));
      }
    });

    return container;
  }

  renderField(key, value) {
    const fieldItem = document.createElement("div");
    fieldItem.className = "field-item";
    fieldItem.innerHTML = `
            <span class="field-key">${key}</span>
            <span class="field-value">${JSON.stringify(value)}</span>
        `;
    return fieldItem;
  }

  makeCollapsible(header, content) {
    const toggleIcon = header.querySelector(".toggle-icon");

    header.addEventListener("click", () => {
      const isShowing = content.classList.contains("show");
      content.classList.toggle("show", !isShowing);
      toggleIcon.classList.toggle("expanded", !isShowing);
      this.updateExpandAllButton();
    });
  }

  renderEmptyState(container) {
    container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📄</div>
                <p>No data to display</p>
            </div>
        `;
    document.getElementById("statsContainer").style.display = "none";
  }

  renderStats(stats) {
    const statsContainer = document.getElementById("statsContainer");
    statsContainer.style.display = "flex";
    statsContainer.innerHTML = `
            <div class="stat-item"><span>Sections:</span><span class="stat-value">${stats.sections}</span></div>
            <div class="stat-item"><span>Arrays:</span><span class="stat-value">${stats.arrays}</span></div>
            <div class="stat-item"><span>Fields:</span><span class="stat-value">${stats.fields}</span></div>
            <div class="stat-item"><span>Rows:</span><span class="stat-value">${stats.rows}</span></div>
        `;
  }

  updateExpandAllButton() {
    const sections = document.querySelectorAll(".toon-section");
    let allExpanded = true;
    let allCollapsed = true;

    sections.forEach((section) => {
      const content = section.querySelector(".section-content");
      if (content) {
        if (content.classList.contains("show")) {
          allCollapsed = false;
        } else {
          allExpanded = false;
        }
      }
    });

    const expandText = document.getElementById("expandAllText");
    if (sections.length === 0 || allCollapsed) {
      expandText.textContent = "Expand All";
      this.allExpanded = false;
    } else if (allExpanded) {
      expandText.textContent = "Collapse All";
      this.allExpanded = true;
    } else {
      expandText.textContent = "Expand All";
      this.allExpanded = false;
    }
  }

  toggleAllSections(expand) {
    const sections = document.querySelectorAll(".toon-section");

    sections.forEach((section) => {
      const content = section.querySelector(".section-content");
      const icon = section.querySelector(".toggle-icon");

      if (content && icon) {
        content.classList.toggle("show", expand);
        icon.classList.toggle("expanded", expand);
      }
    });

    this.allExpanded = expand;
    this.updateExpandAllButton();
  }
}

class ToonVisualizer {
  constructor() {
    this.parser = new ToonParser();
    this.renderer = new ToonRenderer();
    this.exampleTOON = `
users[3]{id,name,role,active}:
  1,Alice,admin,true
  2,Bob,user,true
  3,Charlie,guest,false

settings:
  theme: dark
  notifications: null
  timeout: 300

tags[4]: js,css,"react, vue",html

location:
  city: "New York"
  zip: 10001
`.trim();

    this.initializeEventListeners();
  }

  initializeEventListeners() {
    document
      .getElementById("visualizeBtn")
      .addEventListener("click", () => this.visualize());
    document
      .getElementById("clearBtn")
      .addEventListener("click", () => this.clear());
    document
      .getElementById("exampleBtn")
      .addEventListener("click", () => this.loadExample());
    document
      .getElementById("expandAllBtn")
      .addEventListener("click", () => this.toggleAll());
  }

  visualize() {
    const input = document.getElementById("toonInput").value;
    this.clearError();

    if (!input.trim()) {
      this.showError("Please enter TOON data.");
      return;
    }

    try {
      const { data, stats } = this.parser.parse(input);
      this.renderer.render(
        data,
        document.getElementById("toonContainer"),
        stats,
      );
      document.getElementById("outputPanel").style.display = "block";
    } catch (error) {
      this.showError(error.message);
    }
  }

  clear() {
    document.getElementById("toonInput").value = "";
    this.clearError();
    document.getElementById("toonContainer").innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📄</div>
                <p>No data to display</p>
            </div>`;
    document.getElementById("outputPanel").style.display = "none";
    document.getElementById("statsContainer").style.display = "none";
  }

  loadExample() {
    document.getElementById("toonInput").value = this.exampleTOON;
    this.visualize();
  }

  toggleAll() {
    const expandText = document.getElementById("expandAllText").textContent;
    const shouldExpand = expandText === "Expand All";
    this.renderer.toggleAllSections(shouldExpand);
  }

  showError(message) {
    const errorContainer = document.getElementById("errorContainer");
    errorContainer.innerHTML = `
            <div class="error">
                <div class="error-title">Parse Error</div>
                <div>${message}</div>
            </div>`;
    document.getElementById("outputPanel").style.display = "none";
  }

  clearError() {
    document.getElementById("errorContainer").innerHTML = "";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  new ToonVisualizer();
});
