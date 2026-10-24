// 通知を受け取るためのファイル（ブラウザがバックグラウンドで動かします）
// Firebaseの設定値は、アプリが登録するときに config.js の値をURLに付けて渡します（ここを書き換える必要はありません）
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

let cfg = {};
try { cfg = JSON.parse(new URL(self.location.href).searchParams.get("cfg") || "{}"); } catch (e) { }

if (cfg.apiKey) {
  firebase.initializeApp(cfg);
  // 通知の表示とタップ時の動作はFirebaseが自動で行う（送信側で notification を付けて送るため）
  firebase.messaging();
}
// 通知をタップしたときに開くページは、送信側の webpush.fcmOptions.link で指定する
