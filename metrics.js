'use strict';
var measured = require('measured');
// var metricsCollection = measured.createCollection();
var gc = (require('gc-stats'))();
var eventLoopStats = require("event-loop-stats");
var memwatch = require('memwatch-next');
var schedule = require('node-schedule');
var usage = require('pidusage');
var trackedMetrics = {};
var interval = 1000; // how often to refresh our measurement
var cpuUsage;


var CATEGORIES = {
  all: 'global.all',
  statuses: 'statuses',
  methods: 'methods',
  endpoints: 'endpoints'
};

var NAMESPACES = {
  process: 'process',
  internalMetrics: 'internalMetrics',
  apiMetrics: 'apiMetrics'
}

var cpuUsageScheduleJob;

module.exports.getAll = function (reset) {
  var metricsAsJson = JSON.stringify(trackedMetrics);
  if (reset)
    resetAll();
  return metricsAsJson;
}

module.exports.processMetrics = function (reset) {
  var metricsAsJson = JSON.stringify(trackedMetrics[NAMESPACES.process]);
  if (reset)
    resetProcessMetrics();
  return metricsAsJson;
}

module.exports.apiMetrics = function (reset) {
  var metricsAsJson = JSON.stringify(trackedMetrics[NAMESPACES.apiMetrics]);
  if (reset)
    resetMetric(NAMESPACES.apiMetrics);
  return metricsAsJson;
}

module.exports.internalMetrics = function (reset) {
  var metricsAsJson = JSON.stringify(trackedMetrics[NAMESPACES.internalMetrics]);
  if (reset)
    resetMetric(NAMESPACES.internalMetrics);
  return metricsAsJson;
}

module.exports.logInternalMetric = function (info, err) {
  var status = "success";

  if (err) {
    status = "failure";
  }

  addInnerIO({
    destenation: info.source,
    method: info.methodName,
    status: status,
    elapsedTime: Date.now() - info.startTime
  });
}

module.exports.addApiData = function (message) {
  var metricName = getMetricName(message.route, message.method);
  // var path = message.route ? message.route.path : undefined;

  updateMetric(NAMESPACES.apiMetrics + '.' + CATEGORIES.all, message.time);
  updateMetric(NAMESPACES.apiMetrics + '.' + CATEGORIES.statuses + '.' + message.status, message.time);
  updateMetric(NAMESPACES.apiMetrics + '.' + CATEGORIES.methods + '.' + message.method, message.time);
  updateMetric(NAMESPACES.apiMetrics + '.' + CATEGORIES.endpoints + '.' + metricName, message.time);
};

function getMetricName(route, methodName) {
  return route + '|' + methodName.toLowerCase();
};

function addInnerIO(message) {
  updateMetric(NAMESPACES.internalMetrics + '.' + message.destenation + '.' + CATEGORIES.all, message.elapsedTime);
  updateMetric(NAMESPACES.internalMetrics + '.' + message.destenation + '.' + CATEGORIES.statuses + '.' + message.status, message.elapsedTime);
  updateMetric(NAMESPACES.internalMetrics + '.' + message.destenation + '.' + CATEGORIES.methods + '.' + message.method, message.elapsedTime)
}

function _evtparse(eventName) {
  var namespaces = eventName.split('.');

  var name1;
  var levels = namespaces.length;
  var name = namespaces.pop(),
    category = namespaces.pop(),
    namespace = namespaces.pop();

  if (levels == 4) {
    name1 = name;
    name = category;
    category = namespace;
    namespace = namespaces.pop();
  }

  return {
    ns: namespace,
    name: name,
    name1: name1,
    category: category
  }
}

function addMetric(eventName, metric) {
  var parts = _evtparse(eventName);
  var metricsPath;

  if (!trackedMetrics[parts.ns]) {
    trackedMetrics[parts.ns] = {};
  }
  if (!trackedMetrics[parts.ns][parts.category]) {
    trackedMetrics[parts.ns][parts.category] = {};
  }
  if (!trackedMetrics[parts.ns][parts.category][parts.name]) {
    if (parts.name1) {
      trackedMetrics[parts.ns][parts.category][parts.name] = {}
    }
    else {
      trackedMetrics[parts.ns][parts.category][parts.name] = metric;
    }
  }

  if ((parts.name1) && (!trackedMetrics[parts.ns][parts.category][parts.name][parts.name1])) {
    trackedMetrics[parts.ns][parts.category][parts.name][parts.name1] = metric;
  }

  if(parts.name1) {
    return trackedMetrics[parts.ns][parts.category][parts.name][parts.name1];
  }
  else {
    return trackedMetrics[parts.ns][parts.category][parts.name];
  }
}

function updateMetric(name, elapsedTime) {
  var metric = addMetric(name, new measured.Timer());
  metric.update(elapsedTime);
}

function addProcessMetrics() {
  memwatch.on('leak', function (info) {
    trackedMetrics[NAMESPACES.process]["memory"]["leak"] = info;
  });

  gc.removeAllListeners('stats');
  gc.on('stats', function (stats) {
    updateMetric(NAMESPACES.process + ".gc.time", stats.pauseMS);
    //in bytes
    updateMetric(NAMESPACES.process + ".gc.releasedMem", stats.diff.usedHeapSize);
  });

  addMetric(NAMESPACES.process + ".cpu.usage", new measured.Gauge(function () {
    return cpuUsage;
  }))

  addMetric(NAMESPACES.process + ".memory.usage", new measured.Gauge(function () {
    //in bytes
    return process.memoryUsage();
  }));

  addMetric(NAMESPACES.process + ".eventLoop.latency", new measured.Gauge(function () {
    return eventLoopStats.sense();
  }));

  setCpuUsageScheduleJob();
}

function setCpuUsageScheduleJob() {
  if (cpuUsageScheduleJob) {
    cpuUsageScheduleJob.cancel();
  }
  cpuUsageScheduleJob = schedule.scheduleJob('*/1 * * * *', function () {
    var pid = process.pid;
    usage.stat(pid, function (err, result) {
      cpuUsage = result.cpu;
    });
  });
}

function resetAll() {
  resetProcessMetrics();
  resetMetric(NAMESPACES.apiMetrics);
  resetMetric(NAMESPACES.internalMetrics);
}

function resetProcessMetrics() {
  resetMetric(NAMESPACES.process);
  addProcessMetrics();
}

function resetMetric(namespaceToReset) {
  delete trackedMetrics[namespaceToReset];
}

addProcessMetrics();