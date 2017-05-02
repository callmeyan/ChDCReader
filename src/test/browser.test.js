define(["chai"], function(chai){

  let assert = chai.assert;
  let equal = assert.equal;
  let p = assert.property;


  describe('浏览器基础测试', () => {

    it('Array', () => {
      ["every", "slice", "splice", "fill", "filter", "find", "findIndex", "forEach", "includes", "reduce", "sort", "some", "reverse"].forEach(e => p([], e));
    });

    it('String', () => {
      ["includes", "slice", "startsWith", "endsWith"].forEach(e => p("", e));
    });

    it('Object', () => {
      ["assign", "keys", "values"].forEach(e => p(Object, e));
      ["name"].forEach(e => p({}.constructor, e));
    });

    it('document', () => {
      ["addEventListener", "removeEventListener"].forEach(e => p(document, e));
    });

    it('DOM Element', () => {
      ["remove", "appendChild", "innerHTML", "getAttribute", "textContent",
      "querySelector", "querySelectorAll", "offsetTop", "offsetHeight", "getBoundingClientRect",
      "insertBefore", "children"].forEach(e => p(document.createElement("div"), e));
    });


  });

});
