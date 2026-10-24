export function copyLibmediaAssets(publicDir:string):void;
export function libmediaChunkPlugin():{
 name:string;
 configureServer(server:{middlewares:{use(handler:(req:any,res:any,next:()=>void)=>void):void}}):void;
};
