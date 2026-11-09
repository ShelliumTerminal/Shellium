// Throwaway SSH server for the Linux test container: 127.0.0.1:2222, user tester / tester-pass.
// Shell sessions echo what they receive; SFTP serves a small fixed directory listing.
const fs = require("fs");
const path = require("path");
const { Server, utils } = require("/app/node_modules/ssh2");

const keyFile = path.join(require("os").tmpdir(), "shellium-test-hostkey");
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, utils.generateKeyPairSync("ed25519").private);

new Server({ hostKeys: [fs.readFileSync(keyFile)] }, (client) => {
  client.on("authentication", (ctx) => {
    if (ctx.method === "password" && ctx.username === "tester" && ctx.password === "tester-pass") ctx.accept();
    else ctx.reject(["password"]);
  });
  client.on("ready", () => {
    client.on("session", (accept) => {
      const session = accept();
      session.on("pty", (acceptPty) => acceptPty && acceptPty());
      session.on("window-change", (acceptChange) => acceptChange && acceptChange());
      session.on("shell", (acceptShell) => {
        const stream = acceptShell();
        stream.write("linux-test-shell ready\r\n$ ");
        stream.on("data", (data) => stream.write(data.toString().replace(/\r/g, "\r\n")));
      });
      session.on("sftp", (acceptSftp) => {
        const sftp = acceptSftp();
        const { STATUS_CODE } = utils.sftp;
        let listed = false;
        const attrs = { mode: 0o40755, uid: 0, gid: 0, size: 4096, atime: 0, mtime: 0 };
        sftp.on("REALPATH", (id) => sftp.name(id, [{ filename: "/home/tester", longname: "/home/tester", attrs }]));
        sftp.on("STAT", (id) => sftp.attrs(id, attrs));
        sftp.on("LSTAT", (id) => sftp.attrs(id, attrs));
        sftp.on("OPENDIR", (id) => { listed = false; sftp.handle(id, Buffer.from("dir")); });
        sftp.on("READDIR", (id) => {
          if (listed) return sftp.status(id, STATUS_CODE.EOF);
          listed = true;
          sftp.name(id, [{ filename: "linux-file.txt", longname: "-rw-r--r-- 1 tester tester 42 Oct  1 10:00 linux-file.txt", attrs: { ...attrs, mode: 0o100644, size: 42 } }]);
        });
        sftp.on("CLOSE", (id) => sftp.status(id, STATUS_CODE.OK));
      });
    });
  });
}).listen(2222, "127.0.0.1", () => console.log("listening 2222"));
