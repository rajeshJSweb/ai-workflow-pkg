# ai-workflow-pkg

Reusable Node.js package for AI workflow utilities and helpers.

## 📦 Installation

You can install this package directly from GitHub.

### 🔓 Option 1: Public Repository

If the repository is public:

```bash
npm install git+https://github.com/rajeshJSweb/ai-workflow-pkg.git#v1.0.0
```

> Replace `v1.0.0` with the latest tag or commit hash you want to use.

---

### 🔐 Option 2: Private Repository

If the repository is private, you have two options:

#### A. Use SSH (Recommended for private repos)

1. Generate an SSH key (if not already):

   ```bash
   ssh-keygen -t ed25519 -C "your_email@example.com"
   ```

2. Add the public key (`~/.ssh/id_ed25519.pub`) to your GitHub repo as a **Deploy Key** under:

   ```
   GitHub → Repo → Settings → Deploy Keys
   ```

3. Then install using SSH:

   ```bash
   npm install git+ssh://git@github.com/rajeshJSweb/ai-workflow-pkg.git#v1.0.0
   ```

---

#### B. Use Personal Access Token (PAT)

1. Create a GitHub PAT with `repo` scope.
2. Install with:

   ```bash
   npm install https://<TOKEN>@github.com/rajeshJSweb/ai-workflow-pkg.git#v1.0.0
   ```

> Not recommended for production due to security concerns.

---

## 🛠 Usage

After installation, import and use functions as needed:

```js
const { handleAIFunctionWorkflow } = require("ai-workflow-pkg");

// Use it in your logic
handleAIFunctionWorkflow();
```

---

## 🔄 Versioning

To get a new version after an update:

1. Pull the latest changes in the package repo.
2. Bump the version using the `update-package.sh` script.
3. Commit and push.
4. In your main project:

   ```bash
   npm install git+https://github.com/rajeshJSweb/ai-workflow-pkg.git#v1.0.X
   ```

---

## 📁 Environment Variables

This package may require certain environment variables to function. Create a `.env` file in your main project and add:

```
YOUR_ENV_KEY=value
```

> ⚠️ `.env` is ignored in the package repo, so keys must be defined in the main project.

---

## 👨‍💻 Author

**Rajesh Khoksi**
[GitHub Profile](https://github.com/rajeshJSweb)

---

## 📝 License

MIT
