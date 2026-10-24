import type {IncomingMessage, ServerResponse} from 'node:http';
export function createCastBroker(options?: {stateFile?:string; publicUrl?:string;trustProxy?:boolean; now?:()=>number}): {
  handler(req:IncomingMessage, res:ServerResponse, next?:()=>void): Promise<void>;
  dispatch(body:unknown, context?:unknown): Promise<any>;
};
