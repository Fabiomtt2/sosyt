import { copyFileSync,mkdirSync } from "node:fs";
const destination=new URL("../apps/client/public/downloads/",import.meta.url);
mkdirSync(destination,{recursive:true});
copyFileSync(new URL("../companion/sos_companion.py",import.meta.url),new URL("sos-companion.py",destination));
copyFileSync(new URL("../companion/README.md",import.meta.url),new URL("companion-instrucoes.txt",destination));
