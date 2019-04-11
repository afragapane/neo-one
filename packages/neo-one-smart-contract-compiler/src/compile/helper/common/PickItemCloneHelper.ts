import ts from 'typescript';
import { ScriptBuilder } from '../../sb';
import { VisitOptions } from '../../types';
import { Helper } from '../Helper';

// Input: [index, arr]
// Output: [val]
export class PickItemCloneHelper extends Helper {
  public emit(sb: ScriptBuilder, node: ts.Node, options: VisitOptions): void {
    // [val]
    sb.emitOp(node, 'PICKITEM');
    sb.emitHelper(
      node,
      options,
      sb.helpers.if({
        condition: () => {
          // [val, val]
          sb.emitOp(node, 'DUP');
          // [bool, val]
          sb.emitHelper(node, options, sb.helpers.isStruct);
        },
        whenTrue: () => {
          // [val]
          sb.emitOp(node, 'DROP');
          // [object]
          sb.emitOp(node, 'NEWSTRUCT');
        },
        whenFalse: () => {
          // [val]
          sb.emitOp(node, 'DROP');
        },
      }),
    );
  }
}
