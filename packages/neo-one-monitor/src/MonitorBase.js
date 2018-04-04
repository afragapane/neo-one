/* @flow */
import type { Context } from 'koa';

import _ from 'lodash';

import { utils } from '@neo-one/utils';

import type {
  Carrier,
  CaptureLogOptions,
  CaptureLogSingleOptions,
  CaptureMonitor,
  CaptureSpanOptions,
  CaptureSpanLogOptions,
  Counter,
  Format,
  Gauge,
  Histogram,
  Labels,
  LogErrorOptions,
  LogErrorSingleOptions,
  LogLevelOption,
  LogSingleOptions,
  LogLevel,
  LogMetricOptions,
  LogOptions,
  MetricOptions,
  MetricConstruct,
  Monitor,
  Report,
  Span,
  SpanContext,
  SpanOptions,
  Summary,
} from './types';
import createTracer from './createTracer';

export type LoggerLogOptions = {|
  name: string,
  level: LogLevel,
  message?: string,
  labels?: Labels,
  data?: Labels,
  error?: ?Error,
|};

export type FullLogLevelOption = {|
  log: LogLevel,
  metric: LogLevel,
  span: LogLevel,
|};

export interface Logger {
  log(options: LoggerLogOptions): void;
  close(callback: () => void): void;
}

export interface TracerSpan {
  log(data: Object): void;
  setTag(name: string, value: string | number | boolean): void;
  finish(finishTime?: number): void;
  context(): SpanContext;
}
export type TracerReference = any;
export type TracerStartSpanOptions = {|
  references?: Array<TracerReference>,
  tags?: Object,
  startTime?: number,
|};

export interface Tracer {
  startSpan(name: string, options?: TracerStartSpanOptions): TracerSpan;
  childOf(span: SpanContext | TracerSpan): TracerReference;
  followsFrom(span: SpanContext | TracerSpan): TracerReference;
  extract(format: Format, carrier: Carrier): SpanContext;
  inject(context: SpanContext, format: Format, carrier: Carrier): void;
  close(callback: () => void): void;
}

export type Now = () => number;

export type RawLabels = Labels;
export type TagLabels = Labels;
export type MetricLabels = Labels;

type SpanData = {|
  histogram?: {|
    name: string,
    help?: string,
    labelNames?: Array<string>,
  |},
  time: number,
  span?: TracerSpan,
  // eslint-disable-next-line
  parent?: MonitorBase,
|};

export interface CounterMetric {
  inc(labels?: Labels, count?: number): void;
}

export interface GaugeMetric {
  inc(labels?: Labels, count?: number): void;
  dec(labels?: Labels, count?: number): void;
  set(labels: Labels, value: number): void;
}

export interface HistogramMetric {
  observe(labels?: Labels, value?: number): void;
}

export interface SummaryMetric {
  observe(labels: Labels, value: number): void;
}

export interface MetricsFactory {
  createCounter(options: MetricConstruct): CounterMetric;
  createGauge(options: MetricConstruct): GaugeMetric;
  createHistogram(options: MetricConstruct): HistogramMetric;
  createSummary(options: MetricConstruct): SummaryMetric;
}

type MonitorBaseOptions = {|
  service: string,
  component: string,
  labels?: RawLabels,
  data?: RawLabels,
  logger: Logger,
  tracer?: Tracer,
  now: Now,
  metricsLogLevel?: LogLevel,
  spanLogLevel?: LogLevel,
  span?: SpanData,
  metricsFactory: MetricsFactory,
|};

const counters: { [name: string]: CounterMetric } = {};
const gauges: { [name: string]: GaugeMetric } = {};
const histograms: { [name: string]: HistogramMetric } = {};
const summaries: { [name: string]: SummaryMetric } = {};

export const reset = (): void => {
  for (const counter of Object.keys(counters)) {
    delete counters[counter];
  }
  for (const gauge of Object.keys(gauges)) {
    delete gauges[gauge];
  }
  for (const histogram of Object.keys(histograms)) {
    delete histograms[histogram];
  }
  for (const summary of Object.keys(summaries)) {
    delete summaries[summary];
  }
};

export const KNOWN_LABELS = {
  // These are added automatically
  SERVICE: 'service',
  COMPONENT: 'component',

  DB_INSTANCE: 'db.instance',
  DB_STATEMENT: 'db.statement',
  DB_TYPE: 'db.type',
  DB_USER: 'db.user',
  ERROR: 'error',
  ERROR_KIND: 'error.kind',
  ERROR_OBJECT: 'error.object',
  ERROR_STACK: 'stack',
  HTTP_METHOD: 'http.method',
  HTTP_STATUS_CODE: 'http.status_code',
  HTTP_URL: 'http.url',
  MESSAGE_BUS_DESTINATION: 'message_bus.destination',
  PEER_ADDRESS: 'peer.address',
  PEER_HOSTNAME: 'peer.hostname',
  PEER_IPV4: 'peer.ipv4',
  PEER_IPV6: 'peer.ipv6',
  PEER_PORT: 'peer.port',
  PEER_SERVICE: 'peer.service',
  SAMPLING_PRIORITY: 'sampling.priority',
  SPAN_KIND: 'span.kind',

  DB_STATEMENT_SUMMARY: 'db.statement_summary',
  HTTP_PATH: 'http.path',
  HTTP_FULLPATH: 'http.full_path',
  HTTP_USER_AGENT: 'http.user_agent',
  HTTP_REQUEST_SIZE: 'http.request.size',
  HTTP_HEADERS: 'http.headers',
  HTTP_REQUEST_PROTOCOL: 'http.request.protocol',
  HTTP_REQUEST_QUERY: 'http.request.query',
  RPC_METHOD: 'rpc.method',
  RPC_TYPE: 'rpc.type',
};

const FORMATS = {
  HTTP: 'http_headers',
  TEXT: 'text_map',
  BINARY: 'binary',
};

const dotRegex = /\./g;
export const convertMetricLabel = (dotLabel: string): string =>
  dotLabel.replace(dotRegex, '_');

export const convertMetricLabels = (labelsIn?: RawLabels): MetricLabels => {
  if (labelsIn == null) {
    return {};
  }

  const labels = {};
  for (const key of Object.keys(labelsIn)) {
    labels[convertMetricLabel(key)] = labelsIn[key];
  }
  return labels;
};

export const convertTagLabel = (dotLabel: string): string => dotLabel;

export const convertTagLabels = (labelsIn?: RawLabels): TagLabels => {
  if (labelsIn == null) {
    return {};
  }

  const labels = {};
  for (const key of Object.keys(labelsIn)) {
    labels[convertTagLabel(key)] = labelsIn[key];
  }
  return labels;
};

const LOG_LEVEL_TO_LEVEL = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
  silly: 5,
};

type ReferenceType = 'childOf' | 'followsFrom';

class DefaultReference {
  _type: ReferenceType;
  _span: SpanContext | MonitorBase;

  constructor(span: SpanContext | $FlowFixMe) {
    this._span = span;
  }

  isValid(): boolean {
    // eslint-disable-next-line
    return !(this._span instanceof MonitorBase) || this._span.hasSpan();
  }

  getTracerReference(tracer: Tracer): ?TracerReference {
    if (!this.isValid()) {
      throw new Error('Programming error');
    }

    let context = this._span;
    // eslint-disable-next-line
    if (context instanceof MonitorBase) {
      context = context.getSpan().span;
    }

    if (context == null) {
      return null;
    }

    return this._type === 'childOf'
      ? tracer.childOf(context)
      : tracer.followsFrom(context);
  }
}

class ChildOfReference extends DefaultReference {
  _type = 'childOf';
}

class FollowsFromReference extends DefaultReference {
  _type = 'followsFrom';
}

class MetricWrapper {
  _metric: CounterMetric | GaugeMetric | HistogramMetric | SummaryMetric;
  _labels: MetricLabels;

  constructor({
    metric,
    labels,
  }: {|
    metric: CounterMetric | GaugeMetric | HistogramMetric | SummaryMetric,
    labels: RawLabels,
  |}) {
    this._metric = metric;
    this._labels = convertMetricLabels(labels);
  }

  _getArgs(
    valueOrLabels?: RawLabels | number,
    value?: number,
  ): [MetricLabels, number | void] {
    if (valueOrLabels == null || typeof valueOrLabels === 'number') {
      return [{ ...this._labels }, valueOrLabels];
    }

    return [{ ...this._labels, ...convertMetricLabels(valueOrLabels) }, value];
  }

  inc(countOrLabels?: number | RawLabels, count?: number): void {
    ((this._metric: $FlowFixMe): CounterMetric | GaugeMetric).inc(
      ...this._getArgs(countOrLabels, count),
    );
  }

  dec(countOrLabels?: number | RawLabels, count?: number): void {
    ((this._metric: $FlowFixMe): GaugeMetric).dec(
      ...this._getArgs(countOrLabels, count),
    );
  }

  set(countOrLabels?: number | RawLabels, count?: number): void {
    ((this._metric: $FlowFixMe): GaugeMetric).set(
      ...(this._getArgs(countOrLabels, count): $FlowFixMe),
    );
  }

  observe(countOrLabels?: number | RawLabels, count?: number): void {
    ((this._metric: $FlowFixMe): HistogramMetric | SummaryMetric).observe(
      ...(this._getArgs(countOrLabels, count): $FlowFixMe),
    );
  }
}

type CommonLogOptions = {|
  name: string,
  message?: string,
  level?: LogLevelOption,

  help?: string,
  metric?: LogMetricOptions,
  labelNames?: Array<string>,

  labels?: Labels,
  data?: Labels,

  error?: {
    error?: ?Error,
    message?: string,
    level?: LogLevel,
  },
|};

export default class MonitorBase implements Span {
  labels = KNOWN_LABELS;
  formats = FORMATS;
  _service: string;
  _component: string;
  _labels: RawLabels;
  _data: RawLabels;
  _logger: Logger;
  _metricsLogLevel: LogLevel;
  _spanLogLevel: LogLevel;
  _tracer: Tracer;
  now: Now;
  _span: SpanData | void;
  _metricsFactory: MetricsFactory;

  constructor({
    service,
    component,
    labels,
    data,
    logger,
    metricsLogLevel,
    spanLogLevel,
    tracer,
    now,
    span,
    metricsFactory,
  }: MonitorBaseOptions) {
    this._service = service;
    this._component = component;
    this._labels = labels || {};
    this._data = data || {};
    this._logger = logger;
    this._metricsLogLevel =
      metricsLogLevel == null ? 'verbose' : metricsLogLevel;
    this._spanLogLevel = spanLogLevel == null ? 'info' : spanLogLevel;
    this._tracer = tracer || createTracer();
    this.now = now;
    this._span = span;
    this._metricsFactory = metricsFactory;
  }

  nowSeconds(): number {
    return this.now() / 1000;
  }

  at(component: string): Monitor {
    return this._clone({ component });
  }

  withLabels(labels: RawLabels): Monitor {
    return this._clone({ mergeLabels: labels });
  }

  withData(data: RawLabels): Monitor {
    return this._clone({ mergeData: data });
  }

  // eslint-disable-next-line
  forContext(ctx: Context): Monitor {
    return this;
  }

  // eslint-disable-next-line
  forMessage(ctx: http$IncomingMessage): Monitor {
    return this;
  }

  log({
    name,
    message,
    level,
    help,
    metric,
    labelNames,
    error,
  }: LogOptions): void {
    this._commonLog({
      name,
      message,
      level,
      help,
      metric:
        metric == null
          ? {
              type: 'counter',
              suffix: 'total',
            }
          : metric,
      labelNames,
      error,
    });
  }

  captureLog(
    func: (monitor: CaptureMonitor) => $FlowFixMe,
    options: CaptureLogOptions,
  ): $FlowFixMe {
    let { error: errorObj } = options;
    if (errorObj == null) {
      errorObj = undefined;
    } else if (typeof errorObj === 'string') {
      errorObj = { message: errorObj, level: 'error' };
    }
    const errorObjFinal = errorObj;
    const log = this._clone();
    const doLog = (error?: ?Error) =>
      log.log({
        name: options.name,
        message: options.message,
        level: options.level,
        help: options.help,
        metric: options.metric,
        labelNames: options.labelNames,
        error:
          errorObjFinal == null
            ? undefined
            : {
                message: errorObjFinal.message,
                error,
                level: errorObjFinal.level,
              },
      });

    try {
      const result = func(log);

      if (result != null && result.then != null) {
        return result
          .then(res => {
            doLog();
            return res;
          })
          .catch(err => {
            doLog(err);
            throw err;
          });
      }

      doLog();
      return result;
    } catch (error) {
      doLog(error);
      throw error;
    }
  }

  logSingle({ name, message, level, error }: LogSingleOptions): void {
    this._commonLog({ name, message, level, error });
  }

  captureLogSingle(
    func: (monitor: CaptureMonitor) => $FlowFixMe,
    options: CaptureLogSingleOptions,
    disableClone?: boolean,
  ): $FlowFixMe {
    let { error: errorObj } = options;
    if (errorObj == null) {
      errorObj = undefined;
    } else if (typeof errorObj === 'string') {
      errorObj = { message: errorObj, level: 'error' };
    }
    const errorObjFinal = errorObj;
    const log = disableClone ? this : this._clone();
    const doLog = (error?: ?Error) =>
      log.logSingle({
        name: options.name,
        message: options.message,
        level: options.level,
        error:
          errorObjFinal == null
            ? undefined
            : {
                message: errorObjFinal.message,
                error,
                level: errorObjFinal.level,
              },
      });

    try {
      const result = func(log);

      if (result != null && result.then != null) {
        return result
          .then(res => {
            doLog();
            return res;
          })
          .catch(err => {
            doLog(err);
            throw err;
          });
      }

      doLog();
      return result;
    } catch (error) {
      doLog(error);
      throw error;
    }
  }

  logError({
    name,
    message,
    level,
    help,
    metric,
    labelNames,
    error,
  }: LogErrorOptions): void {
    let errorLevel = level;
    if (errorLevel == null) {
      errorLevel = 'error';
    } else if (typeof errorLevel === 'object') {
      errorLevel = errorLevel.log;
    }
    this._commonLog({
      name,
      message,
      level: level == null ? 'error' : level,
      help,
      metric:
        metric == null
          ? {
              type: 'counter',
              suffix: 'total',
            }
          : metric,
      labelNames,
      error: { error, message, level: errorLevel },
    });
  }

  logErrorSingle({ name, message, level, error }: LogErrorSingleOptions): void {
    let errorLevel = level;
    if (errorLevel == null) {
      errorLevel = 'error';
    } else if (typeof errorLevel === 'object') {
      errorLevel = errorLevel.log;
    }
    this._commonLog({
      name,
      message,
      level: level == null ? 'error' : level,
      error: { error, message, level: errorLevel },
    });
  }

  getCounter(options: MetricOptions): Counter {
    return this._getMetricWrapper(
      this._getCounter(this._getMetricConstruct(options)),
      options,
    );
  }

  _getCounter(options: MetricConstruct): CounterMetric {
    const { name } = options;
    if (counters[name] == null) {
      counters[name] = this._metricsFactory.createCounter(options);
    }
    return counters[name];
  }

  getGauge(options: MetricOptions): Gauge {
    const { name } = options;
    if (gauges[name] == null) {
      gauges[name] = this._metricsFactory.createGauge(
        this._getMetricConstruct(options),
      );
    }

    return this._getMetricWrapper(gauges[name], options);
  }

  getHistogram(options: MetricOptions): Histogram {
    return this._getMetricWrapper(
      this._getHistogram(this._getMetricConstruct(options)),
      options,
    );
  }

  _getHistogram(options: MetricConstruct): HistogramMetric {
    const { name } = options;
    if (histograms[name] == null) {
      histograms[name] = this._metricsFactory.createHistogram(options);
    }
    return histograms[name];
  }

  getSummary(options: MetricOptions): Summary {
    const { name } = options;
    if (summaries[name] == null) {
      summaries[name] = this._metricsFactory.createSummary(
        this._getMetricConstruct(options),
      );
    }

    return this._getMetricWrapper(summaries[name], options);
  }

  startSpan({
    name,
    level,
    help,
    labelNames,
    references: referenceIn,
    trace,
  }: SpanOptions): MonitorBase {
    let span;
    let parent;

    const fullLevel = this._getFullLevel(level);
    const references = (referenceIn || [])
      .concat([this.childOf(this)])
      .map(reference => {
        if (reference instanceof DefaultReference && reference.isValid()) {
          return reference.getTracerReference(this._tracer);
        }

        return null;
      })
      .filter(Boolean);
    if (
      LOG_LEVEL_TO_LEVEL[fullLevel.span] <=
        LOG_LEVEL_TO_LEVEL[this._spanLogLevel] &&
      (trace || references.length > 0)
    ) {
      span = this._tracer.startSpan(name, {
        references,
        tags: this._getSpanTags(),
      });
      parent = this;
    }

    let histogram;
    if (
      LOG_LEVEL_TO_LEVEL[fullLevel.metric] <=
      LOG_LEVEL_TO_LEVEL[this._metricsLogLevel]
    ) {
      histogram = { name: `${name}_duration_seconds`, help, labelNames };
    }

    let currentParent;
    if (this.hasSpan()) {
      ({ parent: currentParent } = this.getSpan());
    }

    const timeMS = this.now();
    const time = timeMS / 1000;
    return this._clone({
      span: {
        histogram,
        time,
        span,
        parent: parent == null ? currentParent : parent,
      },
    });
  }

  end(error?: boolean): void {
    const span = this.getSpan();
    const { histogram } = span;
    const finishTimeMS = this.nowSeconds();
    const finishTime = finishTimeMS / 1000;
    if (histogram != null) {
      const value = finishTime - span.time;
      this.getHistogram({
        name: histogram.name,
        help: histogram.help,
        labelNames: (histogram.labelNames || []).concat([this.labels.ERROR]),
      }).observe({ [convertMetricLabel(this.labels.ERROR)]: !!error }, value);
    }

    const { span: tracerSpan } = span;
    if (tracerSpan != null) {
      tracerSpan.setTag(this.labels.ERROR, !!error);
      tracerSpan.finish();
    }
  }

  captureSpan(
    func: (span: MonitorBase) => $FlowFixMe,
    options: CaptureSpanOptions,
  ): $FlowFixMe {
    const span = this.startSpan({
      name: options.name,
      level: options.level,
      help: options.help,
      labelNames: options.labelNames,
      references: options.references,
      trace: options.trace,
    });
    try {
      const result = func(span);

      if (result != null && result.then != null) {
        return result
          .then(res => {
            span.end();
            return res;
          })
          .catch(err => {
            span.end(true);
            throw err;
          });
      }

      span.end();
      return result;
    } catch (error) {
      span.end(true);
      throw error;
    }
  }

  captureSpanLog(
    func: (span: CaptureMonitor) => $FlowFixMe,
    options: CaptureSpanLogOptions,
  ): $FlowFixMe {
    return this.captureSpan(
      span =>
        span.captureLogSingle(
          log => func(log),
          {
            name: options.name,
            level: options.level,
            message: options.message,
            error: options.error == null ? {} : options.error,
          },
          true,
        ),
      {
        name: options.name,
        level: options.level,
        help: options.help,
        labelNames: options.labelNames,
        references: options.references,
        trace: options.trace,
      },
    );
  }

  childOf(span: SpanContext | Monitor | void): $FlowFixMe {
    if (span == null) {
      return undefined;
    }
    return (new ChildOfReference((span: $FlowFixMe)): $FlowFixMe);
  }

  followsFrom(span: SpanContext | Monitor | void): $FlowFixMe {
    if (span == null) {
      return undefined;
    }
    return (new FollowsFromReference((span: $FlowFixMe)): $FlowFixMe);
  }

  extract(format: Format, carrier: Carrier): SpanContext | void {
    return this._tracer.extract(format, carrier);
  }

  inject(format: Format, carrier: Carrier): void {
    const span = this._span;
    if (span != null && span.span != null) {
      this._tracer.inject(span.span.context(), format, carrier);
    }
  }

  report(report: Report): void {
    report.logs.forEach(log => {
      const { error } = log;
      let errorObj;
      if (error != null) {
        errorObj = new Error(error.message);
        if (error.stack != null) {
          errorObj.stack = error.stack;
        }
        if (error.code != null) {
          (errorObj: $FlowFixMe).code = error.code;
        }
      }
      this._logger.log({
        name: log.name,
        level: log.level,
        message: log.message,
        labels: log.labels,
        data: log.data,
        error: error == null ? undefined : errorObj,
      });
    });

    utils.values(report.metrics.counters).forEach(counterMetric => {
      const counter = this._getCounter(counterMetric.metric);
      counterMetric.values.forEach(value => {
        counter.inc(value.labels, value.count);
      });
    });

    utils.values(report.metrics.histograms).forEach(histMetric => {
      const histogram = this._getHistogram(histMetric.metric);
      histMetric.values.forEach(value => {
        histogram.observe(value.labels, value.count);
      });
    });
  }

  // eslint-disable-next-line
  serveMetrics(port: number): void {}

  close(callback: () => void): void {
    this._closeInternal()
      .then(() => {
        callback();
      })
      .catch(() => {
        callback();
      });
  }

  setLabels(labels: RawLabels): void {
    this._setSpanLabels(labels);
    this._labels = { ...this._labels, ...labels };
  }

  setData(data: RawLabels): void {
    this._setSpanLabels(data);
    this._data = { ...this._data, ...data };
  }

  hasSpan(): boolean {
    return this._span != null;
  }

  getSpan(): SpanData {
    const span = this._span;
    if (span == null) {
      throw new Error('Programming error: Called end on a regular Monitor.');
    }

    return span;
  }

  _commonLog({
    name,
    message: messageIn,

    level,
    help,
    metric,
    labelNames: labelNamesIn,

    error,
  }: CommonLogOptions): void {
    let labels = {};
    let message = messageIn;
    const fullLevel = this._getFullLevel(level);
    let logLevel = fullLevel.log;
    let metricLevel = LOG_LEVEL_TO_LEVEL[fullLevel.metric];
    if (error != null) {
      labels = { ...labels };
      labels[KNOWN_LABELS.ERROR] = error.error != null;
      labels[KNOWN_LABELS.ERROR_KIND] = this._getErrorKind(error.error);
      const errorLevel = error.level == null ? 'error' : error.level;
      metricLevel = Math.min(metricLevel, LOG_LEVEL_TO_LEVEL[errorLevel]);
      const { error: errorObj } = error;
      if (errorObj != null) {
        logLevel = errorLevel;
        const { message: errorMessage } = error;
        if (errorMessage == null) {
          message = errorMessage;
        } else {
          const dot = errorMessage.endsWith('.') ? '' : '.';
          message = `${errorMessage}${dot} ${errorObj.message}`;
        }
      }
    }

    if (
      metricLevel <= LOG_LEVEL_TO_LEVEL[this._metricsLogLevel] &&
      metric != null
    ) {
      const metricName = `${name}_${metric.suffix}`;
      const labelNames = (labelNamesIn || []).concat(Object.keys(labels));
      if (metric.type === 'counter') {
        this.getCounter({
          name: metricName,
          help,
          labelNames,
        }).inc(labels);
      } else {
        const value = metric.value == null ? 1 : metric.value;
        if (metric.type === 'gauge') {
          this.getGauge({
            name: metricName,
            help,
            labelNames,
          }).set(labels, value);
        } else if (metric.type === 'histogram') {
          this.getHistogram({
            name: metricName,
            help,
            labelNames,
          }).observe(labels, value);
        } else {
          this.getSummary({
            name: metricName,
            help,
            labelNames,
          }).observe(labels, value);
        }
      }
    }

    // Gather up all information for logging
    this._logger.log({
      name,
      level: logLevel,
      message,
      labels: convertTagLabels(this._getAllRawLabels(labels)),
      data: convertTagLabels(this._getAllRawData()),
      error: error == null ? undefined : error.error,
    });

    const { span: tracerSpan } = this._span || {};
    if (
      LOG_LEVEL_TO_LEVEL[fullLevel.span] <=
        LOG_LEVEL_TO_LEVEL[this._spanLogLevel] &&
      tracerSpan != null
    ) {
      const spanLog = ({
        event: name,
        message,
        ...this._getSpanTags(labels),
      }: Object);
      if (error != null) {
        const { error: errorObj } = error;
        if (errorObj != null) {
          spanLog[this.labels.ERROR_OBJECT] = errorObj;
          spanLog[this.labels.ERROR_STACK] = errorObj.stack;
        }
      }
      // Only log information from the current point in time
      tracerSpan.log(spanLog);
    }
  }

  _getErrorKind(error?: ?Error): string {
    if (error == null) {
      return 'n/a';
    }

    return (error: $FlowFixMe).code == null
      ? error.constructor.name
      : (error: $FlowFixMe).code;
  }

  _getMetricConstruct({
    name,
    help = 'Placeholder',
    labelNames: labelNamesIn,
  }: MetricOptions): MetricConstruct {
    const labelNames = this._getMetricLabelNames(labelNamesIn).map(labelName =>
      convertMetricLabel(labelName),
    );
    return { name, help, labelNames };
  }

  _getMetricLabelNames(labelNames?: Array<string>): Array<string> {
    return (labelNames || []).concat([
      this.labels.SERVICE,
      this.labels.COMPONENT,
    ]);
  }

  _getMetricWrapper(
    metric: CounterMetric | GaugeMetric | HistogramMetric | SummaryMetric,
    options: MetricOptions,
  ): Counter & Gauge & Histogram & Summary {
    const labelNames = this._getMetricLabelNames(options.labelNames);
    const labelNamesSet = new Set(labelNames);
    const labels = _.pickBy(this._labels, (value, key: string) =>
      labelNamesSet.has(key),
    );

    return new MetricWrapper({ metric, labels });
  }

  _getSpanTags(labels?: RawLabels): TagLabels {
    let spanLabels = this._getAllRawLabels();
    let spanData = this._getAllRawData();
    if (this.hasSpan()) {
      const { parent } = this.getSpan();
      if (parent != null) {
        const parentLabels = new Set(Object.keys(parent._labels));
        spanLabels = _.omitBy(spanLabels, label => parentLabels.has(label));
        const parentData = new Set(Object.keys(parent._data));
        spanData = _.omitBy(spanData, label => parentData.has(label));
      }
    }

    return convertTagLabels({
      ...spanLabels,
      ...spanData,
      ...(labels || {}),
    });
  }

  _getAllRawLabels(labels?: RawLabels): RawLabels {
    if (labels == null) {
      return this._labels;
    }

    return {
      ...this._labels,
      ...labels,
      [this.labels.SERVICE]: this._service,
      [this.labels.COMPONENT]: this._component,
    };
  }

  _getAllRawData(labels?: RawLabels): RawLabels {
    if (labels == null) {
      return this._data;
    }

    return { ...this._data, ...labels };
  }

  _setSpanLabels(labels: RawLabels): void {
    const span = this._span || {};
    const { span: tracerSpan } = span;
    if (tracerSpan != null) {
      const tagLabels = convertTagLabels(labels);
      for (const key of Object.keys(tagLabels)) {
        if (tagLabels[key] != null) {
          tracerSpan.setTag(key, tagLabels[key]);
        }
      }
    }
  }

  _getFullLevel(levelIn?: LogLevelOption): FullLogLevelOption {
    let level = levelIn;
    if (level == null) {
      level = 'info';
    }

    if (typeof level === 'string') {
      return {
        log: level,
        metric: level,
        span: level,
      };
    }

    return {
      log: level.log,
      metric: level.metric == null ? level.log : level.metric,
      span: level.span == null ? level.log : level.span,
    };
  }

  _clone(options?: {|
    component?: string,
    mergeLabels?: Labels,
    mergeData?: Labels,
    span?: SpanData,
  |}) {
    const { component, mergeLabels, mergeData, span } = options || {};
    let mergedLabels = this._labels;
    if (mergeLabels != null) {
      mergedLabels = { ...this._labels, ...mergeLabels };
    }

    let mergedData = this._data;
    if (mergeData != null) {
      mergedData = { ...this._data, ...mergeData };
    }

    return new this.constructor({
      service: this._service,
      component: component == null ? this._component : component,
      logger: this._logger,
      tracer: this._tracer,
      now: this.now,
      labels: mergedLabels,
      data: mergedData,
      span: span == null ? this._span : span,
      metricsLogLevel: this._metricsLogLevel,
      spanLogLevel: this._spanLogLevel,
      metricsFactory: this._metricsFactory,
    });
  }

  async _closeInternal(): Promise<void> {
    await Promise.all([
      new Promise(resolve => {
        this._logger.close(() => resolve());
      }),
      new Promise(resolve => {
        this._tracer.close(() => resolve());
      }),
    ]);
  }
}
