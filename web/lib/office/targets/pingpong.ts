import { defineTarget } from './types';
import { PINGPONG_TABLE } from '../pingpong/table';
import { pingPongSession } from '../pingpong/session';

export const pingPongTarget = defineTarget<{ kind: 'pingpong' }>({
  id: 'pingpong',
  candidates: () => [{ target: { kind: 'pingpong' }, position: [PINGPONG_TABLE.x, PINGPONG_TABLE.z], radius: 0.65 }],
  label: () => 'Play ping pong',
  activate: () => pingPongSession.start(),
  panel: () => null,
});
