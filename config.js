// ===== 設定（手順は README.md） =====

// Firebaseコンソール →「プロジェクトの設定」→「マイアプリ」のウェブアプリに表示される値を貼り付ける
// （通知用のファイル firebase-messaging-sw.js も、ここの値を自動で使います。2か所に貼る必要はありません）
export const firebaseConfig = {
  apiKey: "AIzaSyCxmWo2AmjU7MNo0oUe3ph9T1vlFrJGqp4",
  authDomain: "shin-board.firebaseapp.com",
  projectId: "shin-board",
  storageBucket: "shin-board.firebasestorage.app",
  messagingSenderId: "973208913635",
  appId: "1:973208913635:web:44f8b2634013f32c8aa7d6"
};

// 管理者（すべてを編集できる人）のGoogleアカウントのメールアドレス。
// firestore.rules の管理者アドレスと必ず同じにすること。2人目を追加するときは両方に書き足す。
// ※ここは画面の出し分け用。実際の権限は firestore.rules が決めます。
export const ADMIN_EMAILS = ["akira.sato@shincareer.com"];
