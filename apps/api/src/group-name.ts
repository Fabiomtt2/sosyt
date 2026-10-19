/** Only the actual SOS family: plain numeric suffix or the owner's $N$ notation. */
export function groupCodeFromSubject(subject:string):string|undefined{
 const match=/^SOS\s+YOUTUBER\s+(?:([1-9]\d{0,2})|\$([1-9]\d{0,2})\$)$/iu.exec(subject.trim());
 return match?.[1]??match?.[2];
}
