import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const java = process.env.JAVA_HOME ?? "/usr/lib/jvm/java-21-openjdk-amd64";
const sdk = process.env.ANDROID_HOME ?? join(root, ".android-sdk");
const user = join(root, ".android-home"), temporary = join(root, ".local-tmp");
mkdirSync(user, { recursive: true }); mkdirSync(temporary, { recursive: true });
if (!existsSync(join(sdk, "platforms/android-35/android.jar"))) {
  console.error("SDK Android 35 ausente. Consulte docs/ANDROID.md."); process.exit(1);
}
const run = spawnSync("./gradlew", ["assembleDebug", "--no-daemon", "--max-workers=2",
  "-Dorg.gradle.jvmargs=-Xmx1024m", "-Duser.home=" + user, "-Djava.io.tmpdir=" + temporary],
  { cwd: join(root, "apps/client/android"), stdio: "inherit", env: {
    ...process.env, LC_ALL: "C.UTF-8", JAVA_HOME: java, ANDROID_HOME: sdk, ANDROID_USER_HOME: user,
    GRADLE_USER_HOME: join(root, ".gradle-home"), TMPDIR: temporary
  } });
if (run.error) console.error(run.error.message);
process.exit(run.status ?? 1);
