import { tsUtils } from '@neo-one/ts-utils';
import ts from 'typescript';
import { isBuffer } from '../../helper/types';
import { ScriptBuilder } from '../../sb';
import { VisitOptions } from '../../types';
import { BuiltinInstanceMemberCall } from '../BuiltinInstanceMemberCall';
import { CallMemberLikeExpression } from '../types';

// tslint:disable-next-line export-name
export class BufferEquals extends BuiltinInstanceMemberCall {
  public canCall(sb: ScriptBuilder, _func: CallMemberLikeExpression, node: ts.CallExpression): boolean {
    const arg = tsUtils.argumented.getArguments(node)[0] as ts.Expression | undefined;
    if (arg === undefined) {
      /* istanbul ignore next */
      return false;
    }

    const type = sb.context.analysis.getType(arg);

    return type !== undefined && isBuffer(sb.context, arg, type);
  }

  public emitCall(
    sb: ScriptBuilder,
    func: CallMemberLikeExpression,
    node: ts.CallExpression,
    optionsIn: VisitOptions,
    visited: boolean,
  ): void {
    const options = sb.pushValueOptions(optionsIn);
    if (!visited) {
      // [arrayVal]
      sb.visit(tsUtils.expression.getExpression(func), options);
    }

    if (tsUtils.argumented.getArguments(node).length < 1) {
      /* istanbul ignore next */
      return;
    }

    // [bufferVal, bufferVal]
    sb.visit(tsUtils.argumented.getArguments(node)[0], options);
    // [boolean]
    sb.emitOp(node, 'EQUAL');
    if (optionsIn.pushValue) {
      // [booleanVal]
      sb.emitHelper(node, options, sb.helpers.wrapBoolean);
    } else {
      // []
      sb.emitOp(node, 'DROP');
    }
  }
}
