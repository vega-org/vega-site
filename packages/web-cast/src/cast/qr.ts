/** QR byte mode, version 10, error correction L, mask 0. No remote QR service. */
export function pairingQr(text:string):boolean[][] {
  const bytes=new TextEncoder().encode(text);
  if(bytes.length>271) throw new Error('Pairing invitation exceeds QR capacity');
  const bits:number[]=[];
  const put=(value:number,length:number)=>{for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);};
  put(4,4);put(bytes.length,16);for(const byte of bytes)put(byte,8);
  put(0,Math.min(4,274*8-bits.length));while(bits.length%8)bits.push(0);
  const data:number[]=[];for(let i=0;i<bits.length;i+=8)data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));
  let padding=0;while(data.length<274)data.push(padding++%2===0?0xec:0x11);
  const exp=new Uint8Array(512),log=new Uint8Array(256);let x=1;
  for(let i=0;i<255;i++){exp[i]=x;log[x]=i;x<<=1;if(x&256)x^=0x11d;}
  for(let i=255;i<512;i++)exp[i]=exp[i-255];
  const mul=(a:number,b:number)=>a&&b?exp[log[a]+log[b]]:0;
  let generator=[1];
  for(let i=0;i<18;i++){const next=new Array(generator.length+1).fill(0);for(let j=0;j<generator.length;j++){next[j]^=generator[j];next[j+1]^=mul(generator[j],exp[i]);}generator=next;}
  let offset=0;
  const blocks=[68,68,69,69].map(length=>{const block=data.slice(offset,offset+length);offset+=length;return block;});
  const parity=blocks.map(block=>{const value=[...block,...new Array(18).fill(0)];for(let i=0;i<block.length;i++){const factor=value[i];for(let j=0;j<generator.length;j++)value[i+j]^=mul(factor,generator[j]);}return value.slice(-18);});
  const words:number[]=[];for(let i=0;i<69;i++)for(const block of blocks)if(i<block.length)words.push(block[i]);
  for(let i=0;i<18;i++)for(const block of parity)words.push(block[i]);
  const size=57;
  const matrix:(boolean|null)[][]=Array.from({length:size},()=>new Array(size).fill(null));
  const finder=(row:number,col:number)=>{for(let r=-1;r<=7;r++)for(let c=-1;c<=7;c++)if(row+r>=0&&row+r<size&&col+c>=0&&col+c<size)matrix[row+r][col+c]=(r>=0&&r<=6&&(c===0||c===6))||(c>=0&&c<=6&&(r===0||r===6))||(r>=2&&r<=4&&c>=2&&c<=4);};
  finder(0,0);finder(size-7,0);finder(0,size-7);
  for(const row of [6,28,50])for(const col of [6,28,50])if(matrix[row][col]===null)for(let r=-2;r<=2;r++)for(let c=-2;c<=2;c++)matrix[row+r][col+c]=Math.abs(r)===2||Math.abs(c)===2||(r===0&&c===0);
  for(let i=8;i<size-8;i++){if(matrix[i][6]===null)matrix[i][6]=i%2===0;if(matrix[6][i]===null)matrix[6][i]=i%2===0;}
  const degree=(value:number)=>{let count=0;while(value){count++;value>>>=1;}return count;};
  const bch=(value:number,poly:number,shift:number)=>{let d=value<<shift;while(degree(d)>=degree(poly))d^=poly<<(degree(d)-degree(poly));return(value<<shift)|d;};
  const format=bch(8,0x537,10)^0x5412;
  for(let i=0;i<15;i++){const value=((format>>>i)&1)!==0;matrix[i<6?i:i<8?i+1:size-15+i][8]=value;matrix[8][i<8?size-i-1:i<9?15-i:14-i]=value;}
  matrix[size-8][8]=true;
  const version=bch(10,0x1f25,12);
  for(let i=0;i<18;i++){const value=((version>>>i)&1)!==0;matrix[Math.floor(i/3)][i%3+size-11]=value;matrix[i%3+size-11][Math.floor(i/3)]=value;}
  let row=size-1,increment=-1,byte=0,bit=7;
  for(let col=size-1;col>0;col-=2){if(col===6)col--;for(;;){for(let c=0;c<2;c++)if(matrix[row][col-c]===null){let value=byte<words.length&&((words[byte]>>>bit)&1)!==0;if((row+col-c)%2===0)value=!value;matrix[row][col-c]=value;if(--bit<0){byte++;bit=7;}}row+=increment;if(row<0||row>=size){row-=increment;increment=-increment;break;}}}
  return matrix as boolean[][];
}
