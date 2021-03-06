define([
  "backbone",
  "underscore",
  "../util/util",
  "text!../util/samples/ibex/invokeSample.txt",
], function (Backbone, _, util, invokeSample) {
  return Backbone.View.extend({
    rawInvokes: [],

    initialize: function (codeMirrors, sourceCollection, activeNodeCollection, jsBinRouter) {
      this.activeNodeCollection = activeNodeCollection;

      _(this.returnValueParsers).each(function (fn, i) {
        this.returnValueParsers[i] = _.bind(fn, this);
      }, this);

      _(this.argumentParsers).each(function (fn, i) {
        this.argumentParsers[i] = _.bind(fn, this);
      }, this);

      var instanceId = window.location.pathname.split("/")[1];
      if (!instanceId || instanceId.length < 1) {
        this.addInvokes(JSON.parse(invokeSample));
      }
    },

    toJSON: function () {
      var serializableInvokes = _(this.invokes).map(function (invoke) {
        var str = invoke.node.source;
        var isos = [];
        if (str) {
          _(str.split("iso_")).each(function (s) {
            var arr = s.split("_iso");
            if (arr.length > 1) {
              isos.push(arr[0])
            }
          });
        }

        return {
          childCalls: _(invoke.childCalls).map(function (i) {
            return i.invocationId
          }),
          childAsyncLinks: _(invoke.childAsyncLinks).map(function (i) {
            return i.invocationId
          }),
          childAsyncSerialLinks: _(invoke.childAsyncSerialLinks).map(function (i) {
            return i.invocationId
          }),
          parentCalls: _(invoke.parentCalls).map(function (i) {
            return i.invocationId
          }),
          parentAsyncLink: invoke.parentAsyncLink ? invoke.parentAsyncLink.invocationId : null,
          parentAsyncSerialLinks: _(invoke.parentAsyncSerialLinks).map(function (i) {
            return i.invocationId
          }),


          invocationId: invoke.invocationId,
          topLevelInvocationId: invoke.invocationId,
          isLib: invoke.invocationId,
          nodeId: invoke.nodeId,
          nodeName: invoke.node.name,
          nodeType: invoke.node.type,
          nodeSource: invoke.node.source ? invoke.node.source.substr(0, 300) : null,
          tick: invoke.tick,
          timestamp: invoke.timestamp,
          parents: invoke.parents,
          arguments: invoke.arguments,
          returnValue: invoke.returnValue,

          functionSerials: isos,

          repeatCallCount: invoke.repeatCallCount,

          aspectMap: invoke.aspectMap
        };
      }, this);

      return JSON.stringify(serializableInvokes, null, 2);
    },

    addInvokes: function (invokes) {
      console.log("Adding invokes:", invokes.length);

      _(invokes).each(function (invoke) {
        this.rawInvokes.push(invoke);
      }, this);
    },

    calculate: function () {
      var startTime = new Date().getTime();
      console.log("Processing invokes:", this.rawInvokes.length);

      var pendingEdges = [];
      this.invokes = [];
      this.rootInvokes = [];
      this.nativeInvokes = [];
      this.nativeRootInvokes = [];
      this.argSourceToInvokes = [];
      this.invokeIdMap = {};
      this.edges = [];
      this.asyncEdgeMap = {};
      this.asyncEdges = [];
      this.asyncSerialEdgeMap = {};
      this.asyncSerialEdges = [];
      this.maxHitCount = 0;
      this.aspectCollectionMap = {
        click: [],
        wheel: [],
        scroll: [],
        mousemove: [],
        mousedown: [],
        mouseup: [],
        mouseout: [],
        mouseover: [],
        mouseenter: [],
        mouseleave: [],
        keydown: [],
        keypress: [],
        keyup: [],
        ajaxRequest: [],
        ajaxResponse: [],
        domQuery: [],
        jqDom: [],
        setup: []
      };

      _(this.activeNodeCollection.models).each(function (nodeModel) {
        nodeModel.set("invokes", []);
      });

      // Parse through invokes and populate simple lists of native/lib/top-levels
      _(this.rawInvokes).each(function (rawInvoke) {
        // Make a copy to leave the original
        var invoke = JSON.parse(JSON.stringify(rawInvoke));
        this.invokes.push(invoke);

        invoke.aspectMap = {};
        invoke.getLabel = _.bind(function () {
          return this.getInvokeLabel(invoke);
        }, this);
        this.invokes.push(invoke);
        this.invokeIdMap[invoke.invocationId] = invoke;

        if (invoke.topLevelInvocationId === invoke.invocationId) {
          this.rootInvokes.push(invoke);
          invoke.rootInvoke = true;
        }

        var nodeModel = this.activeNodeCollection.get(invoke.nodeId);
        if (!nodeModel) {
          this.activeNodeCollection.mergeNodes([{
            name: "",
            id: invoke.nodeId,
            source: "",
            invokes: []
          }]);
          nodeModel = this.activeNodeCollection.get(invoke.nodeId);
          console.warn("Creating shell nodemodel for", invoke.nodeId);
        }

        invoke.nodeModel = nodeModel;
        invoke.node = nodeModel.toJSON();

        invoke.isLib = util.isKnownLibrary(invoke.nodeId);

        if (!invoke.isLib) {
          this.nativeInvokes.push(invoke);

          var hasParentCaller = !!_(invoke.parents).find(function (parent) {
            return parent.type === "call";
          });

          if (!hasParentCaller) {
            this.nativeRootInvokes.push(invoke);
            invoke.nativeRootInvoke = true;
          }
        }

        // Store parent links to process when the full invokeMap is done
        _(invoke.parents).each(function (parent) {
          pendingEdges.push({
            parentAttributes: parent,
            childInvoke: invoke
          });
        }, this);

        _(invoke.arguments).each(function (arg) {
          if (arg.value && arg.value.type === "function" && arg.value.json) {
            var source;
            if (arg.value.json.indexOf("function") === -1) {
              var isoStr = arg.value.json;
              var isoStartIndex = isoStr.indexOf("iso_");
              var isoEndIndex = isoStr.indexOf("_iso");

              if (isoStartIndex > -1 && isoEndIndex > -1) {
                var serial = isoStr.substring(isoStartIndex, isoEndIndex + 4);
                var nodeModel = this.activeNodeCollection.serialToNode[serial];
                if (nodeModel) {
                  source = nodeModel.get("source");
                }
              }
            } else {
              source = arg.value.json;
            }

            if (!this.argSourceToInvokes[source]) {
              this.argSourceToInvokes[source] = [];
            }

            // Check if we already have this invoke
            var foundInvoke = _(this.argSourceToInvokes[source])
              .find(function (nrInvoke) {
                return nrInvoke.invocationId === invoke.invocationId
              });

            // Store the invoke arg source to be looked up later
            if (!foundInvoke) {
              this.argSourceToInvokes[source].push(invoke);
            }
          }
        }, this);
      }, this);

      // Parse through edges found and create two-way links between parent and child invokes
      // in two different types: direct call and tom's asyn context
      _(pendingEdges).each(function (edge) {
        if (!edge.parentAttributes || !edge.childInvoke) {
          console.warn("Got some disconnected parent/child invocations.");
          return;
        }

        var parentInvoke = this.invokeIdMap[edge.parentAttributes.invocationId];
        var parentType = edge.parentAttributes.type;
        var childInvoke = edge.childInvoke;

        if (!parentInvoke || !childInvoke || !parentType) {
          console.warn("Couldn't find parent/child invocation nodes.");
          return;
        }

        if (parentType === "async") {
          if (!parentInvoke.childAsyncLinks) {
            parentInvoke.childAsyncLinks = [];
          }

          if (childInvoke.parentAsyncLink) {
            console.warn("Child invoke has multiple parents async links, should not happen!");
          }

          childInvoke.parentAsyncLink = parentInvoke;
          parentInvoke.childAsyncLinks.push(childInvoke);

          var asyncEdge = {
            parentInvoke: parentInvoke,
            childInvoke: childInvoke
          };

          var edgeId = asyncEdge.parentInvoke.invocationId + asyncEdge.childInvoke.invocationId;
          if (!this.asyncEdgeMap[edgeId]) {
            this.asyncEdgeMap[edgeId] = asyncEdge;
            this.asyncEdges.push(asyncEdge);
          }
        } else if (parentType === "call") {
          if (!parentInvoke.childCalls) {
            parentInvoke.childCalls = [];
          }

          if (!childInvoke.parentCalls) {
            childInvoke.parentCalls = [];
          }

          childInvoke.parentCalls.push(parentInvoke);
          parentInvoke.childCalls.push(childInvoke);
          this.edges.push({
            parentInvoke: parentInvoke,
            childInvoke: childInvoke
          });
        } else {
          console.log("Found a new parent type", parentType);
        }

        if (!childInvoke.isLib && parentInvoke.isLib) {
          if (!childInvoke.nativeRootInvoke) {
            childInvoke.nativeRootInvoke = true;
            this.nativeRootInvokes.push(childInvoke);
          }
        }
      }, this);

      // Parse through invoke arguments to determine final missing async serial links
      _(this.nativeRootInvokes).each(function (childInvoke) {
        if (!childInvoke.node.source) {
          return;
        }

        var parentInvokes = this.argSourceToInvokes[childInvoke.node.source];

        if (parentInvokes) {
          _(parentInvokes).each(function (parentInvoke) {
            if (!parentInvoke.childAsyncSerialLinks) {
              parentInvoke.childAsyncSerialLinks = [];
            }

            if (!childInvoke.parentAsyncSerialLinks) {
              childInvoke.parentAsyncSerialLinks = [];
            }

            childInvoke.parentAsyncSerialLinks.push(parentInvoke);
            parentInvoke.childAsyncSerialLinks.push(childInvoke);

            var asyncSerialEdge = {
              parentInvoke: parentInvoke,
              childInvoke: childInvoke
            };

            var edgeId = asyncSerialEdge.parentInvoke.invocationId + asyncSerialEdge.childInvoke.invocationId;
            if (!this.asyncSerialEdgeMap[edgeId]) {
              this.asyncSerialEdgeMap[edgeId] = asyncSerialEdge;
              this.asyncSerialEdges.push(asyncSerialEdge);
            }
          }, this);
        }
      }, this);

      // Add setup attribute to all first tree nodes
      if (this.nativeInvokes[0]) {
        this.nativeInvokes[0].aspectMap["page load"] = true;
        var setupCollection = this.aspectCollectionMap.setup;
        this.descendTree(this.nativeInvokes[0], function (node) {
          node.aspectMap["setup"] = true;
          setupCollection.push(node);
        });
      }

      // Place invokes into queryable buckets
      _(this.invokes).map(this.classifyInvoke, this);

      var stopTime = new Date().getTime();
      console.log("Done processing invokeGraph", parseInt((stopTime - startTime) / 1000), "seconds");
    },


    climbTree: function (node, decorator, stopCondition) {
      decorator(node);

      if (stopCondition && stopCondition(node)) {
        return;
      }

      // Otherwise keep climbing
      _(node.parentCalls).find(function (parentNode) {
        return this.climbTree(parentNode, decorator, stopCondition)
      }, this);
    },

    descendTree: function (node, decorator, stopCondition) {
      decorator(node);

      if (stopCondition && stopCondition(node)) {
        return;
      }

      _(node.childCalls).each(function (node) {
        this.descendTree(node, decorator, stopCondition)
      }, this);
    },

    decorateAspect: function (node, aspect, nodeAspectArr) {
      var decorator = function (invokeNode) {
        invokeNode.aspectMap[aspect] = true;

        if (nodeAspectArr) {
          nodeAspectArr.push(invokeNode);
        }
      };

      decorator = _.bind(decorator, this);
      decorator(node);

      this.climbTree(node, decorator, null);
      // if (node.isLib) {
      //   var stopCondition = function (node) {
      //     return !node.isLib;
      //   };

      this.descendTree(node, decorator, null)
      // }
    },

    parseEventFromArg: function (arg) {
      if (arg && arg.value && arg.value.ownProperties) {
        // jQuery 2, zepto event bindings
        if (arg.value.ownProperties.eventName) {
          if (arg.value.ownProperties.eventName.value.indexOf("Event") > -1) {
            if (arg.value.ownProperties.type) {
              return arg.value.ownProperties.type.value;
            }
          }
        } else if (arg.value.ownProperties.originalEvent) {
          // jQuery 1 event bindings
          if (arg.value.ownProperties.originalEvent.preview) {
            if (arg.value.ownProperties.originalEvent.preview.indexOf("Event") > -1) {
              if (arg.value.ownProperties.type) {
                return arg.value.ownProperties.type.value;
              }
            }
          }
        }
      }

      return null;
    },

    mouseEvents: [
      "click",
      "wheel",
      "scroll",
      "mousemove",
      "mousedown",
      "mouseup",
      "mouseout",
      "mouseover",
      "mouseenter",
      "mouseleave"
    ],

    keyEvents: [
      "keydown",
      "keypress",
      "keyup"
    ],

    ajaxEvents: [
      "ajaxStart",
      "ajaxRequest",
      "ajaxResponse"
    ],

    domQueries: [
      "domQuery",
      "jqDom"
    ],

    argumentParsers: [
      function (arg) {
        return this.parseEventFromArg(arg);
      },
      function (arg) {
        try {
          if ((arg.value.ownProperties.type.value === "load" ||
            arg.value.ownProperties.type.value === "readystatechange" ||
            arg.value.ownProperties.type.value === "xmlhttprequest") &&
            arg.value.ownProperties.status.value !== 0 &&
            arg.value.ownProperties.status.type === "number") {
            return "ajaxResponse";
          }
        } catch (ignored) {
        }
        return null;
      }
    ],

    returnValueParsers: [
      function (returnValue) {
        try {
          if (returnValue.ownProperties.length &&
            returnValue.ownProperties.selector.value) {
            return "jqDom";
          }
        } catch (ignored) {
          return null;
        }
      },
      function (returnValue) {
        try {
          if (returnValue.ownProperties.elementType &&
            returnValue.ownProperties.elementType.value.indexOf("HTML") > -1) {
            return "domQuery";
          }
        } catch (ignored) {
          return null;
        }
      },
      function (returnValue) {
        try {
          if (returnValue.ownProperties.type.value === "xmlhttprequest" ||
            returnValue.ownProperties.status.value === 0) {
            return "ajaxRequest";
          }
        } catch (ignored) {
          return null;
        }
      }
    ],

    deDupInvoke: function (invoke) {
      if (invoke.nodeModel) {
        var nodeInvokes = invoke.nodeModel.get('invokes');
        if (nodeInvokes.length > 0) {
          var hasPriorInvoke = false;

          var nodeMatch = function (invokeA, invokeB) {
            var a = _(invokeA.parentCalls || []).pluck("nodeId").join("");
            a += _(invokeA.childCalls || []).pluck("nodeId").join("");

            var b = _(invokeB.parentCalls || []).pluck("nodeId").join("");
            b += _(invokeB.childCalls || []).pluck("nodeId").join("");

            return a === b;
          };

          _(nodeInvokes).each(function (subInvoke) {
            if (nodeMatch(invoke, subInvoke)) {
              hasPriorInvoke = true;
              subInvoke.isSequentialRepeat = true;
            }
          }, this);

          if (hasPriorInvoke) {
            // Set latest invoke as the non-repeat
            invoke.isSequentialRepeat = false;
          }
        }
        nodeInvokes.push(invoke);
      }
    },

    classifyInvoke: function (invoke) {
      this.deDupInvoke(invoke);

      if (!this.maxHitCount || invoke.node.invokes.length > this.maxHitCount) {
        this.maxHitCount = invoke.node.invokes.length;
      }

      if (invoke.node && invoke.node.name &&
        (invoke.node.name === "('$' callback)" || invoke.node.name.indexOf(".js toplevel") > -1)) {
        invoke.aspectMap["setup"] = true;
        this.aspectCollectionMap.setup.push(invoke);
      }
      // Check return values
      _(this.returnValueParsers).each(function (parser) {
        var aspect = parser(invoke.returnValue);
        if (aspect) {
          this.decorateAspect(invoke, aspect, this.aspectCollectionMap[aspect]);
        }
      }, this);

      // Comb through arguments
      _(invoke.arguments).each(function (arg) {
        _(this.argumentParsers).each(function (parser) {
          var aspect = parser(arg);
          if (aspect) {
            this.decorateAspect(invoke, aspect, this.aspectCollectionMap[aspect]);
          }
        }, this);
      }, this);
    },

    classifyCustom: function (aspect, argTestFn, returnValTestFn) {
      if (!aspect || !(argTestFn || returnValTestFn)) {
        console.warn("Tried classify custom without required params.");
        return;
      }

      var testFn;
      if (argTestFn) {
        testFn = function (invoke) {
          return !!_(invoke.arguments).find(function (arg) {
            return argTestFn(util.unMarshshalVal(arg.value))
          })
        }
      } else if (returnValTestFn) {
        testFn = function (invoke) {
          return invoke.returnValue && !!returnValTestFn(util.unMarshshalVal(invoke.returnValue));
        }
      }

      _(this.invokes).each(function (invoke) {
        var hasAspect;

        try {
          hasAspect = testFn(invoke)
        } catch (ignored) {
        }

        if (hasAspect) {
          this.decorateAspect(invoke, aspect, null);
        }
      }, this);
    },

    getInvokeLabel: function (invoke) {
      if (invoke.node.customLabel) {
        return invoke.node.customLabel;
      }

      var aspects = invoke.aspectMap ? _(invoke.aspectMap).keys().join(", ") : "";
      var name = invoke.node.name;
      // var root = invoke.rootInvoke ? "rootInvoke" : "";
      // var nativeRoot = invoke.nativeRootInvoke ? "nativeRootInvoke" : "";

      var hits = invoke.node.invokes.length;

      if (aspects) {
        aspects = "[" + aspects + "]"
      }

      return [aspects, name, "×", hits].join(" ");
    },

    sort: function () {
      this.invokes.sort(function (a, b) {
        if (a.timestamp > b.timestamp) {
          return 1;
        } else if (a.timestamp < b.timestamp) {
          return -1;
        } else {
          // Secondary sort on tick
          if (a.tick > b.tick) {
            return 1;
          } else if (a.tick < b.tick) {
            return -1;
          } else {
            return 0;
          }
        }
      });
    }
  });
});