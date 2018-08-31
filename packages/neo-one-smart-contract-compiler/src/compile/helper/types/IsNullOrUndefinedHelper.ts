import ts from 'typescript';
import { ScriptBuilder } from '../../sb';
import { VisitOptions } from '../../types';
import { TypedHelper } from './TypedHelper';

// Input: [val]
// Output: [boolean]
export class IsNullOrUndefinedHelper extends TypedHelper {
  public emit(sb: ScriptBuilder, node: ts.Node, options: VisitOptions): void {
    if (!options.pushValue) {
      sb.emitOp(node, 'DROP');

      return;
    }

    const pushFalse = () => {
      sb.emitOp(node, 'DROP');
      sb.emitPushBoolean(node, false);
    };

    const pushTrue = () => {
      sb.emitOp(node, 'DROP');
      sb.emitPushBoolean(node, true);
    };

    sb.emitHelper(
      node,
      options,
      sb.helpers.forBuiltinType({
        type: this.type,
        knownType: this.knownType,
        array: pushFalse,
        arrayStorage: pushFalse,
        boolean: pushFalse,
        buffer: pushFalse,
        null: pushTrue,
        number: pushFalse,
        object: pushFalse,
        string: pushFalse,
        symbol: pushFalse,
        undefined: pushTrue,
        map: pushFalse,
        mapStorage: pushFalse,
        set: pushFalse,
        setStorage: pushFalse,
        error: pushFalse,
        iteratorResult: pushFalse,
        iterable: pushFalse,
        iterableIterator: pushFalse,
        transaction: pushFalse,
        output: pushFalse,
        attribute: pushFalse,
        input: pushFalse,
        account: pushFalse,
        asset: pushFalse,
        contract: pushFalse,
        header: pushFalse,
        block: pushFalse,
      }),
    );
  }
}
