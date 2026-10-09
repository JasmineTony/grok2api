/**
 * zh-CN 文案 · 登录与鉴权。
 * 命名空间：auth。
 */
export default {
  auth: {
    title: "管理员登录",
    productTitle: "轻量 API 网关",
    subtitle: "管理上游账号、模型路由和客户端访问权限。",
    username: "用户名",
    password: "密码",
    usernameRequired: "请输入用户名",
    passwordRequired: "请输入密码",
    signIn: "登录",
    signingIn: "登录中",
    signOut: "退出登录",
    changePassword: "修改密码",
    currentPassword: "当前密码",
    newPassword: "新密码",
    passwordUpdated: "密码已更新，请重新登录。",
    sessionUnavailable: "暂时无法恢复登录状态",
    sessionUnavailableDescription: "服务可能暂时不可用。你的登录会话没有被清除，请稍后重试。",
    retrySession: "重试",
  },
} as const;
