/**************************************/
// Test 1 and Effect 1 Click Handler
// No libraries, just click in response to event
var testElement = document.getElementById("test1");
var eventHandlerFn = function (e) {
  var effect1 = document.getElementById("effect1");
  if (effect1.getAttribute("style") == "display: none;") {
    effect1.setAttribute("style", "display: initial;")
  } else {
    effect1.setAttribute("style", "display: none;")
  }
};
testElement.addEventListener("click", eventHandlerFn);


/**************************************/
// Test 2 and Effect 2 Click Handler
$("#test2").click(function () {
  var $effect2 = $("#effect2");
  var currentMoment = moment().format('MMMM Do YYYY, h:mm:ss a');
  $effect2.append("<p>" + currentMoment + "</p>");
});

/**************************************/
// Test 3 and Effect 3 Distributed Arch
$("#test3").click(function () {
  secondFunction("bim", "Bazz");
});

var secondFunction = function (a, b) {
  (function () {
    var foo = function () {
      thirdFunction(b);
    };
    foo();
  })();
};

var $effect3 = $("#effect3");
var fourthFunction = function (triggerData) {
  $effect3.show("fast");
  window.setTimeout(eighthFunction, 1000);
};

var thirdFunction = function () {
  $("#effect1").off();
  $("#effect1").on("foo-bar", fourthFunction);
  sixthFunction();
};

var seventhFunction = function () {
  $("#effect1").trigger("foo-bar", "some-trigger-data");
};

var sixthFunction = function () {
  var eightFunction = $.proxy(seventhFunction, this);
  window.setTimeout(eightFunction, 1000);
};

var eighthFunction = function () {
  $effect3.hide("fast");
};

/***************************************/
// Non-querying interval function
var intervalFoo = function () {
  var a = 2;
};
//window.setInterval(intervalFoo, 100);
