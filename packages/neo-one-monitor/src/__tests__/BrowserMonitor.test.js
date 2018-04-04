/* @flow */
/* @jest-environment jsdom */
import prom from 'prom-client';

import BrowserMonitor from '../BrowserMonitor';
import BrowserLogger from '../BrowserLogger';
import BrowserMetricsFactory, {
  resetMetricsForTesting,
} from '../BrowserMetricsFactory';
import NodeMonitor from '../NodeMonitor';
import Reporter from '../Reporter';
import { reset, KNOWN_LABELS } from '../MonitorBase';

describe('BrowserMonitor', () => {
  const options1 = {
    name: 'log1',
    level: 'info',
    message: 'test1',
    labels: { label1: 10 },
    data: { data1: '20' },
  };
  const error = new Error('testError');
  (error: $FlowFixMe).code = 'red';
  const options2 = {
    name: 'log2',
    level: 'silly',
    message: 'test2',
    labels: { label2: 30 },
    data: { data1: '40' },
    error,
  };

  const options2Result = {
    ...options2,
    error: {
      message: error.message,
      stack: error.stack,
      code: (error: $FlowFixMe).code,
    },
  };

  const counterOptions1 = {
    name: 'counter1',
    help: 'helpCount',
    labelNames: ['label1', 'label2'],
  };

  const counterResult1 = {
    metric: {
      name: counterOptions1.name,
      help: counterOptions1.help,
      labelNames: [...counterOptions1.labelNames, 'service', 'component'],
    },
    values: [{ count: 5, labels: {} }, { count: 4, labels: {} }],
  };

  const histogramOptions1 = {
    name: 'histogram1',
    help: 'helpHist',
    labelNames: ['histLabel1', 'histLabel2'],
  };

  const histResult1 = {
    metric: {
      name: histogramOptions1.name,
      help: histogramOptions1.help,
      labelNames: [...histogramOptions1.labelNames, 'service', 'component'],
    },
    values: [{ labels: { histLabel1: 14 }, count: 3 }],
  };

  const emptyMetrics = {
    counters: {
      [counterResult1.metric.name]: {
        metric: counterResult1.metric,
        values: [],
      },
    },
    histograms: {
      [histResult1.metric.name]: {
        metric: histResult1.metric,
        values: [],
      },
    },
  };

  const requestCounter = {
    name: 'browser_request_counter',
    help: 'Counts fetch requests from Browser Reporter to endpoint',
    labelNames: [KNOWN_LABELS.ERROR],
  };

  const emptyBackReport = {
    logs: [],
    metrics: {
      counters: {},
      histograms: {},
    },
  };

  let logger = new BrowserLogger();
  let metricsFactory = new BrowserMetricsFactory();
  let monitor = BrowserMonitor.create({
    service: 'namespace1',
    logger,
    metricsFactory,
  });
  beforeEach(() => {
    logger = new BrowserLogger();
    metricsFactory = new BrowserMetricsFactory();
    monitor = BrowserMonitor.create({
      service: 'namespace1',
      logger,
      metricsFactory,
    });
  });

  afterEach(() => {
    reset();
    resetMetricsForTesting();
  });

  test('BrowserLogger', () => {
    expect(logger.collect()).toEqual([]);

    logger.log(options1);
    const firstResult = logger.collect();
    expect(firstResult).toEqual([options1]);

    logger.log(options2);
    const secondResult = logger.collect();
    expect(secondResult).toEqual([options2Result]);

    expect(logger.collect()).toEqual([]);

    const closeFunc = jest.fn();

    logger.close(closeFunc);

    expect(closeFunc).toHaveBeenCalledTimes(1);
  });

  test('BrowserMetricsFactory', () => {
    const counter = monitor.getCounter(counterOptions1);
    counter.inc(5);
    counter.inc(4);

    const histogram = monitor.getHistogram(histogramOptions1);
    histogram.observe({ histLabel1: 14 }, 3);

    const result = metricsFactory.collect();
    expect(result).toEqual({
      counters: { [counterResult1.metric.name]: counterResult1 },
      histograms: { [histResult1.metric.name]: histResult1 },
    });

    expect(metricsFactory.collect()).toEqual(emptyMetrics);

    counter.inc(3);
    expect(metricsFactory.collect()).toEqual({
      ...emptyMetrics,
      counters: {
        [counterResult1.metric.name]: {
          metric: counterResult1.metric,
          values: [{ count: 3, labels: {} }],
        },
      },
    });
  });

  test('Reporter - POST success', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

    const reporter = new Reporter({
      logger,
      metricsFactory,
      timer: 2000,
      endpoint: 'fakeEnd',
    });

    logger.log(options1);

    const counter = monitor.getCounter(counterOptions1);
    counter.inc(5);
    counter.inc(4);

    const firstResult = await reporter._collectReport({
      backReport: emptyBackReport,
      logger,
      metricsFactory,
    });

    expect(firstResult).toEqual(emptyBackReport);

    const histogram = monitor.getHistogram(histogramOptions1);
    histogram.observe({ histLabel1: 14 }, 3);

    const secondResult = await reporter._collectReport({
      backReport: emptyBackReport,
      logger,
      metricsFactory,
    });

    expect(secondResult).toEqual(emptyBackReport);

    expect(fetch.mock.calls).toMatchSnapshot();

    await new Promise(resolve => setTimeout(() => resolve(), 2000));
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);

    const spy = jest.spyOn(reporter._subscription, 'unsubscribe');
    reporter.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('Reporter - POST failure', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false }));

    const reporter = new Reporter({
      logger,
      metricsFactory,
      timer: 2000,
      endpoint: 'fakeEnd',
    });

    logger.log(options1);

    const counter = monitor.getCounter(counterOptions1);
    counter.inc(5);
    counter.inc(4);

    const firstBackReport = {
      logs: [options1],
      metrics: {
        counters: {
          [requestCounter.name]: {
            metric: requestCounter,
            values: [],
          },
          [counterResult1.metric.name]: counterResult1,
        },
        histograms: {},
      },
    };

    const firstResult = await reporter._collectReport({
      backReport: emptyBackReport,
      logger,
      metricsFactory,
    });

    expect(firstResult).toEqual(firstBackReport);

    const histogram = monitor.getHistogram(histogramOptions1);
    histogram.observe({ histLabel1: 14 }, 3);

    const secondBackReport = {
      logs: [],
      metrics: {
        counters: {
          [requestCounter.name]: {
            metric: requestCounter,
            values: [{ labels: { [KNOWN_LABELS.ERROR]: true } }],
          },
          [counterResult1.metric.name]: {
            metric: counterResult1.metric,
            values: [],
          },
        },
        histograms: { [histResult1.metric.name]: histResult1 },
      },
    };

    const secondResult = await reporter._collectReport({
      backReport: emptyBackReport,
      logger,
      metricsFactory,
    });

    expect(secondResult).toEqual(secondBackReport);

    expect(fetch.mock.calls).toMatchSnapshot();

    await new Promise(resolve => setTimeout(() => resolve(), 2000));
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);

    const spy = jest.spyOn(reporter._subscription, 'unsubscribe');
    reporter.close();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  describe('report to Node', () => {
    test('Counter.inc called with same args', () => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

      const reporter = new Reporter({
        logger,
        metricsFactory,
        timer: 1000,
        endpoint: 'fakeEnd',
      });

      const nodeMonitor = NodeMonitor.create({
        service: 'test',
      });
      const fakeCounter = {
        inc: jest.fn(),
      };
      const getCounterSpy = jest
        .spyOn(nodeMonitor, '_getCounter')
        .mockImplementation(() => fakeCounter);
      const counter = monitor.getCounter(counterOptions1);
      counter.inc(5);
      counter.inc(4);
      counter.inc({ label1: 7 });
      counter.inc({ label2: 12 }, 36);

      const testReport = JSON.stringify({
        logs: logger.collect(),
        metrics: metricsFactory.collect(),
      });
      reset();
      nodeMonitor.report(JSON.parse(testReport));

      reporter.close();
      getCounterSpy.mockRestore();

      const nodeCounter = nodeMonitor.getCounter(counterOptions1);
      // $FlowFixMe
      const counterSpy = jest.spyOn(nodeCounter._metric, 'inc');
      nodeCounter.inc(5);
      nodeCounter.inc(4);
      nodeCounter.inc({ label1: 7 });
      nodeCounter.inc({ label2: 12 }, 36);

      expect(fakeCounter.inc.mock.calls).toEqual(counterSpy.mock.calls);
      nodeMonitor.close(() => {});
      reset();
      prom.register.clear();
    });

    test('Histogram.observe called with same args', () => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

      const reporter = new Reporter({
        logger,
        metricsFactory,
        timer: 1000,
        endpoint: 'fakeEnd',
      });

      const nodeMonitor = NodeMonitor.create({
        service: 'test',
      });
      const fakeHist = {
        observe: jest.fn(),
      };
      const getHistSpy = jest
        .spyOn(nodeMonitor, '_getHistogram')
        .mockImplementation(() => fakeHist);
      const histogram = monitor.getHistogram(histogramOptions1);
      histogram.observe({ histLabel1: 14 }, 3);
      histogram.observe(7);

      const testReport = JSON.stringify({
        logs: logger.collect(),
        metrics: metricsFactory.collect(),
      });
      reset();
      nodeMonitor.report(JSON.parse(testReport));

      reporter.close();
      reset();
      getHistSpy.mockRestore();

      const nodeHist = nodeMonitor.getHistogram(histogramOptions1);
      // $FlowFixMe
      const histSpy = jest.spyOn(nodeHist._metric, 'observe');
      nodeHist.observe({ histLabel1: 14 }, 3);
      nodeHist.observe(7);

      expect(fakeHist.observe.mock.calls).toEqual(histSpy.mock.calls);
      nodeMonitor.close(() => {});
      reset();
      prom.register.clear();
    });

    test('Counter in Node matches', () => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

      const reporter = new Reporter({
        logger,
        metricsFactory,
        timer: 1000,
        endpoint: 'fakeEnd',
      });

      const nodeMonitor = NodeMonitor.create({
        service: 'test',
      });
      const getCounterSpy = jest.spyOn(nodeMonitor, '_getCounter');

      const counter = monitor.getCounter(counterOptions1);
      counter.inc(5);
      counter.inc(4);
      counter.inc({ label1: 7 });
      counter.inc({ label2: 12 }, 36);

      const testReport = JSON.stringify({
        logs: logger.collect(),
        metrics: metricsFactory.collect(),
      });
      reset();
      nodeMonitor.report(JSON.parse(testReport));
      reporter.close();
      // $FlowFixMe
      const browserResult = getCounterSpy.mock.returnValues[1];

      const nodeCounter = nodeMonitor.getCounter(counterOptions1);
      nodeCounter.inc(5);
      nodeCounter.inc(4);
      nodeCounter.inc({ label1: 7 });
      nodeCounter.inc({ label2: 12 }, 36);
      // $FlowFixMe
      const nodeResult = getCounterSpy.mock.returnValues[2];

      expect(nodeResult).toEqual(browserResult);
      nodeMonitor.close(() => {});
      reset();
      prom.register.clear();
    });

    test('Histogram in Node matches', () => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

      const reporter = new Reporter({
        logger,
        metricsFactory,
        timer: 1000,
        endpoint: 'fakeEnd',
      });

      const nodeMonitor = NodeMonitor.create({
        service: 'test',
      });
      const getHistSpy = jest.spyOn(nodeMonitor, '_getHistogram');

      const histogram = monitor.getHistogram(histogramOptions1);
      histogram.observe({ histLabel1: 14 }, 3);
      histogram.observe(7);

      const testReport = JSON.stringify({
        logs: logger.collect(),
        metrics: metricsFactory.collect(),
      });
      reset();
      nodeMonitor.report(JSON.parse(testReport));
      reporter.close();
      // $FlowFixMe
      const browserResult = getHistSpy.mock.returnValues[0];

      const nodeHist = nodeMonitor.getHistogram(histogramOptions1);
      nodeHist.observe({ histLabel1: 14 }, 3);
      nodeHist.observe(7);
      // $FlowFixMe
      const nodeResult = getHistSpy.mock.returnValues[1];

      expect(nodeResult).toEqual(browserResult);
      nodeMonitor.close(() => {});
      reset();
      prom.register.clear();
    });

    test('logging', () => {
      global.fetch = jest.fn(() => Promise.resolve({ ok: true }));

      const reporter = new Reporter({
        logger,
        metricsFactory,
        timer: 1000,
        endpoint: 'fakeEnd',
      });

      const nodeMonitor = NodeMonitor.create({
        service: 'test',
      });
      const logSpy = jest.spyOn(nodeMonitor._logger, 'log');

      logger.log(options1);
      logger.log(options2);

      const testReport = JSON.stringify({
        logs: logger.collect(),
        metrics: metricsFactory.collect(),
      });
      nodeMonitor.report(JSON.parse(testReport));
      const browserResult = logSpy.mock.calls.slice(0, 2);
      reporter.close();

      nodeMonitor._logger.log(options1);
      nodeMonitor._logger.log(options2);
      const nodeResult = logSpy.mock.calls.slice(2, 4);

      expect(browserResult).toEqual(nodeResult);
      nodeMonitor.close(() => {});
    });
  });
});
