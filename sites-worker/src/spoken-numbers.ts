/** Conservative English speech normalization. No inference of units or money basis. */
const units:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90};
const words=Object.keys(units).join('|')+'|hundred|thousand|million';
const span=new RegExp(`\\b(?:${words})(?:(?:[ -]+(?:and[ -]+)?)(?:${words}))*\\b`,'gi');
export function normalizeSpokenNumbers(text:string):string {
  return text.replace(/[’‘]/g,"'").replace(span,(raw,offset:number)=>{
    // Keep separate answers separate: "five thousand and three thousand"
    // is a pair, whereas "five thousand and three hundred" is one number.
    const scale=(part:string)=>/million/i.test(part)?1e6:/thousand/i.test(part)?1e3:/hundred/i.test(part)?100:0;
    const join=/\s+and\s+/gi;
    for(const match of raw.matchAll(join)){
      const left=raw.slice(0,match.index),right=raw.slice(match.index!+match[0].length);
      if(!scale(left)||scale(right)>=scale(left))return `${normalizeSpokenNumbers(left)} and ${normalizeSpokenNumbers(right)}`;
    }
    const tokens=raw.toLowerCase().split(/[ -]+/).filter((token:string)=>token!=='and');
    // "one account" and "one day" are counts, not an account's balance.
    if(tokens.length===1&&/^(?:one|two|three|four|five|six|seven|eight|nine)$/.test(tokens[0])&&/^\s+(?:(?:savings|current|checking|retirement)\s+accounts?|accounts?|years? ago|children|kids|months? of)\b/i.test(text.slice(offset+raw.length)))return raw;
    let total=0,group=0;
    for(const token of tokens){if(token==='hundred')group=(group||1)*100;else if(token==='thousand'||token==='million'){total+=(group||1)*(token==='thousand'?1000:1000000);group=0;}else group+=units[token];}
    return String(total+group);
  }).replace(/\b(\d+(?:[.,]\d+)?)\s+grand\b/gi,'$1k');
}
