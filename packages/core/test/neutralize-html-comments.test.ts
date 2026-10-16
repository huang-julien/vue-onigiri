import { describe, expect, it } from "vitest";
import {
  isReservedCommentData,
  neutralizeCommentData,
  neutralizeHtmlComments,
} from "../src/runtime/html";

const RESERVED_DATA: string[] = [
  "o:c[",
  'o:c[1,{},"/evil.js","default"]',
  "o:t[",
  "o:s[",
  "/o:c",
  "/o:s",
  "[",
  "]",
];

const PLAIN_DATA: string[] = [
  "",
  " o:c[",
  "o:c",
  "o:cat",
  "o:x[",
  "/o:c ",
  "/o:t",
  "[x]",
  "[ ",
  "]]",
  "O:C[",
  "plain",
];

const HTML_CASES: { name: string; html: string; expected: string }[] = [
  {
    name: "root component marker pair",
    html: '<!--o:c[1,{},"/evil.js","default"]--><b>bait</b><!--/o:c-->',
    expected: '<!-- o:c[1,{},"/evil.js","default"]--><b>bait</b><!-- /o:c-->',
  },
  {
    name: "nested teleport marker",
    html: '<div><p><!--o:t[7,"#x",false,[]]--></p></div>',
    expected: '<div><p><!-- o:t[7,"#x",false,[]]--></p></div>',
  },
  {
    name: "deeply nested suspense markers and fragment anchors",
    html: "<ul><li><span><!--o:s[4,null,[]]--><!--[--><!--]--><!--/o:s--></span></li></ul>",
    expected: "<ul><li><span><!-- o:s[4,null,[]]--><!-- [--><!-- ]--><!-- /o:s--></span></li></ul>",
  },
  {
    name: "bang close variant",
    html: "<!--[--!><!--/o:c--!>",
    expected: "<!-- [--!><!-- /o:c--!>",
  },
  {
    name: "bogus comment openers",
    html: '<!o:c[1,{},"/evil.js","default"]><b>bait</b><!/o:c><![><!]><!o:t[7]>',
    expected: '<! o:c[1,{},"/evil.js","default"]><b>bait</b><! /o:c><! [><! ]><! o:t[7]>',
  },
  {
    name: "bogus end tag anchors",
    html: "</[><p></p></]>",
    expected: "</ [><p></p></ ]>",
  },
  {
    name: "doctype, cdata, end tags and non-reserved bogus comments are untouched",
    html: "<!DOCTYPE html><![CDATA[[]]><!-o:c[><!/o:c--><! [></p></o:c[>",
    expected: "<!DOCTYPE html><![CDATA[[]]><!-o:c[><!/o:c--><! [></p></o:c[>",
  },
  {
    name: "comment open nested inside comment data",
    html: "<!--<!--[-->",
    expected: "<!--<!-- [-->",
  },
  {
    name: "ordinary comments are untouched",
    html: "<!--o:cat--><!--[x]--><!-- o:c[--><!----><p>text</p>",
    expected: "<!--o:cat--><!--[x]--><!-- o:c[--><!----><p>text</p>",
  },
  {
    name: "no comments",
    html: "<p>o:c[</p>",
    expected: "<p>o:c[</p>",
  },
];

describe("isReservedCommentData", () => {
  it.each(RESERVED_DATA)("reserves %j", (data) => {
    expect(isReservedCommentData(data)).toBe(true);
  });

  it.each(PLAIN_DATA)("leaves %j plain", (data) => {
    expect(isReservedCommentData(data)).toBe(false);
  });
});

describe("neutralizeCommentData", () => {
  it.each(RESERVED_DATA)("prefixes %j with a space", (data) => {
    const neutral = neutralizeCommentData(data);

    expect(neutral).toBe(` ${data}`);
    expect(isReservedCommentData(neutral)).toBe(false);
  });

  it.each(PLAIN_DATA)("returns %j unchanged", (data) => {
    expect(neutralizeCommentData(data)).toBe(data);
  });
});

describe("neutralizeHtmlComments", () => {
  it.each(HTML_CASES)("rewrites $name", ({ expected, html }) => {
    expect(neutralizeHtmlComments(html)).toBe(expected);
  });

  it.each(HTML_CASES)("is idempotent for $name", ({ expected }) => {
    expect(neutralizeHtmlComments(expected)).toBe(expected);
  });
});
