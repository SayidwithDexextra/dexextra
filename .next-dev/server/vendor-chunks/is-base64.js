/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/is-base64";
exports.ids = ["vendor-chunks/is-base64"];
exports.modules = {

/***/ "(rsc)/./node_modules/is-base64/is-base64.js":
/*!*********************************************!*\
  !*** ./node_modules/is-base64/is-base64.js ***!
  \*********************************************/
/***/ (function(module, exports) {

eval(";(function(root) {\n  'use strict';\n\n  function isBase64(v, opts) {\n    if (v instanceof Boolean || typeof v === 'boolean') {\n      return false\n    }\n\n    if (!(opts instanceof Object)) {\n      opts = {}\n    }\n\n    if (opts.allowEmpty === false && v === '') {\n      return false\n    }\n\n    var regex = '(?:[A-Za-z0-9+\\\\/]{4})*(?:[A-Za-z0-9+\\\\/]{2}==|[A-Za-z0-9+\\/]{3}=)?'\n    var mimeRegex = '(data:\\\\w+\\\\/[a-zA-Z\\\\+\\\\-\\\\.]+;base64,)'\n\n    if (opts.mimeRequired === true) {\n      regex =  mimeRegex + regex\n    } else if (opts.allowMime === true) {\n      regex = mimeRegex + '?' + regex\n    }\n\n    if (opts.paddingRequired === false) {\n      regex = '(?:[A-Za-z0-9+\\\\/]{4})*(?:[A-Za-z0-9+\\\\/]{2}(==)?|[A-Za-z0-9+\\\\/]{3}=?)?'\n    }\n\n    return (new RegExp('^' + regex + '$', 'gi')).test(v)\n  }\n\n  if (true) {\n    if ( true && module.exports) {\n      exports = module.exports = isBase64\n    }\n    exports.isBase64 = isBase64\n  } else {}\n})(this);\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvaXMtYmFzZTY0L2lzLWJhc2U2NC5qcyIsIm1hcHBpbmdzIjoiQUFBQSxDQUFDO0FBQ0Q7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTs7QUFFQSxvQ0FBb0MsRUFBRSxxQkFBcUIsRUFBRSxrQkFBa0IsRUFBRTtBQUNqRixxREFBcUQ7O0FBRXJEO0FBQ0E7QUFDQSxNQUFNO0FBQ047QUFDQTs7QUFFQTtBQUNBLGtDQUFrQyxFQUFFLHFCQUFxQixFQUFFLHNCQUFzQixFQUFFO0FBQ25GOztBQUVBO0FBQ0E7O0FBRUEsTUFBTSxJQUE4QjtBQUNwQyxRQUFRLEtBQTZCO0FBQ3JDO0FBQ0E7QUFDQSxJQUFJLGdCQUFnQjtBQUNwQixJQUFJLEtBQUssRUFNTjtBQUNILENBQUMiLCJzb3VyY2VzIjpbIi9Vc2Vycy9ncGxheV9zYXlpZC9EZXNrdG9wL0NPREUvZGV4ZXh0cmEvbm9kZV9tb2R1bGVzL2lzLWJhc2U2NC9pcy1iYXNlNjQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiOyhmdW5jdGlvbihyb290KSB7XG4gICd1c2Ugc3RyaWN0JztcblxuICBmdW5jdGlvbiBpc0Jhc2U2NCh2LCBvcHRzKSB7XG4gICAgaWYgKHYgaW5zdGFuY2VvZiBCb29sZWFuIHx8IHR5cGVvZiB2ID09PSAnYm9vbGVhbicpIHtcbiAgICAgIHJldHVybiBmYWxzZVxuICAgIH1cblxuICAgIGlmICghKG9wdHMgaW5zdGFuY2VvZiBPYmplY3QpKSB7XG4gICAgICBvcHRzID0ge31cbiAgICB9XG5cbiAgICBpZiAob3B0cy5hbGxvd0VtcHR5ID09PSBmYWxzZSAmJiB2ID09PSAnJykge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuXG4gICAgdmFyIHJlZ2V4ID0gJyg/OltBLVphLXowLTkrXFxcXC9dezR9KSooPzpbQS1aYS16MC05K1xcXFwvXXsyfT09fFtBLVphLXowLTkrXFwvXXszfT0pPydcbiAgICB2YXIgbWltZVJlZ2V4ID0gJyhkYXRhOlxcXFx3K1xcXFwvW2EtekEtWlxcXFwrXFxcXC1cXFxcLl0rO2Jhc2U2NCwpJ1xuXG4gICAgaWYgKG9wdHMubWltZVJlcXVpcmVkID09PSB0cnVlKSB7XG4gICAgICByZWdleCA9ICBtaW1lUmVnZXggKyByZWdleFxuICAgIH0gZWxzZSBpZiAob3B0cy5hbGxvd01pbWUgPT09IHRydWUpIHtcbiAgICAgIHJlZ2V4ID0gbWltZVJlZ2V4ICsgJz8nICsgcmVnZXhcbiAgICB9XG5cbiAgICBpZiAob3B0cy5wYWRkaW5nUmVxdWlyZWQgPT09IGZhbHNlKSB7XG4gICAgICByZWdleCA9ICcoPzpbQS1aYS16MC05K1xcXFwvXXs0fSkqKD86W0EtWmEtejAtOStcXFxcL117Mn0oPT0pP3xbQS1aYS16MC05K1xcXFwvXXszfT0/KT8nXG4gICAgfVxuXG4gICAgcmV0dXJuIChuZXcgUmVnRXhwKCdeJyArIHJlZ2V4ICsgJyQnLCAnZ2knKSkudGVzdCh2KVxuICB9XG5cbiAgaWYgKHR5cGVvZiBleHBvcnRzICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmICh0eXBlb2YgbW9kdWxlICE9PSAndW5kZWZpbmVkJyAmJiBtb2R1bGUuZXhwb3J0cykge1xuICAgICAgZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gaXNCYXNlNjRcbiAgICB9XG4gICAgZXhwb3J0cy5pc0Jhc2U2NCA9IGlzQmFzZTY0XG4gIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gICAgZGVmaW5lKFtdLCBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiBpc0Jhc2U2NFxuICAgIH0pXG4gIH0gZWxzZSB7XG4gICAgcm9vdC5pc0Jhc2U2NCA9IGlzQmFzZTY0XG4gIH1cbn0pKHRoaXMpO1xuIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6WzBdLCJzb3VyY2VSb290IjoiIn0=\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/is-base64/is-base64.js\n");

/***/ })

};
;