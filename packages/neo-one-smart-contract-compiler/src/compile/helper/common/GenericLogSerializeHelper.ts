import ts from 'typescript';
import { GlobalProperty, InternalObjectProperty } from '../../constants';
import { ScriptBuilder } from '../../sb';
import { VisitOptions } from '../../types';
import { Helper } from '../Helper';
import { invokeLogSerialize } from './serialize';

// Input: [val]
// Output: []
export class GenericLogSerializeHelper extends Helper {
  public readonly needsGlobal = true;

  public emitGlobal(sb: ScriptBuilder, node: ts.Node, optionsIn: VisitOptions): void {
    const options = sb.pushValueOptions(optionsIn);

    const doNothing = () => {
      // do nothing
    };

    const throwTypeError = (innerOptions: VisitOptions) => {
      // []
      sb.emitOp(node, 'DROP');
      sb.emitHelper(node, innerOptions, sb.helpers.throwTypeError);
    };

    const handleArray = (innerOptions: VisitOptions) => {
      // [arr]
      sb.emitHelper(node, innerOptions, sb.helpers.unwrapArray);
      sb.emitHelper(
        node,
        innerOptions,
        sb.helpers.arrMap({
          map: (innerInnerOptions) => {
            invokeLogSerialize(sb, node, innerInnerOptions);
          },
        }),
      );
      // [val]
      sb.emitHelper(node, innerOptions, sb.helpers.wrapArray);
    };

    const handleObject = (innerOptions: VisitOptions) => {
      // [val, val]
      sb.emitOp(node, 'DUP');
      // [values, val]
      sb.emitHelper(node, innerOptions, sb.helpers.getPropertyObjectValues);
      // [values, val]
      sb.emitHelper(
        node,
        innerOptions,
        sb.helpers.arrMap({
          map: (innerInnerOptions) => {
            // [val]
            invokeLogSerialize(sb, node, innerInnerOptions);
          },
        }),
      );
      // [val, values]
      sb.emitOp(node, 'SWAP');
      // [keys, values]
      sb.emitHelper(node, innerOptions, sb.helpers.getPropertyObjectKeys);
      // [keys, values]
      sb.emitHelper(
        node,
        innerOptions,
        sb.helpers.arrMap({
          map: (innerInnerOptions) => {
            // [val]
            sb.emitHelper(node, innerInnerOptions, sb.helpers.wrapString);
          },
        }),
      );
      // [2, keys, values]
      sb.emitPushInt(node, 2);
      // [arr]
      sb.emitOp(node, 'PACK');
      // [val]
      sb.emitHelper(node, innerOptions, sb.helpers.wrapObject);
    };

    // [number, globalObject]
    sb.emitPushInt(node, GlobalProperty.GenericLogSerialize);
    // [farr, number, globalObject]
    sb.emitHelper(
      node,
      options,
      sb.helpers.createFunctionArray({
        body: (innerOptionsIn) => {
          const innerOptions = sb.pushValueOptions(innerOptionsIn);
          // [0, argsarr]
          sb.emitPushInt(node, 0);
          // [val]
          sb.emitOp(node, 'PICKITEM');
          // [val]
          sb.emitHelper(
            node,
            innerOptions,
            sb.helpers.forBuiltinType({
              type: undefined,
              array: handleArray,
              arrayStorage: throwTypeError,
              boolean: doNothing,
              buffer: doNothing,
              null: doNothing,
              number: doNothing,
              object: handleObject,
              string: doNothing,
              symbol: doNothing,
              undefined: doNothing,
              map: throwTypeError,
              mapStorage: throwTypeError,
              set: throwTypeError,
              setStorage: throwTypeError,
              error: throwTypeError,
              iteratorResult: throwTypeError,
              iterable: throwTypeError,
              iterableIterator: throwTypeError,
              transaction: throwTypeError,
              output: throwTypeError,
              attribute: throwTypeError,
              input: throwTypeError,
              account: throwTypeError,
              asset: throwTypeError,
              contract: throwTypeError,
              header: throwTypeError,
              block: throwTypeError,
            }),
          );
          // []
          sb.emitHelper(node, innerOptions, sb.helpers.return);
        },
      }),
    );
    // [objectVal, number, globalObject]
    sb.emitHelper(
      node,
      options,
      sb.helpers.createFunctionObject({
        property: InternalObjectProperty.Call,
      }),
    );
    // []
    sb.emitOp(node, 'SETITEM');
  }

  public emit(sb: ScriptBuilder, node: ts.Node, options: VisitOptions): void {
    if (!options.pushValue) {
      sb.emitOp(node, 'DROP');

      return;
    }

    invokeLogSerialize(sb, node, options);
  }
}
