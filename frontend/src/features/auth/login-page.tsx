import { zodResolver } from "@hookform/resolvers/zod";
import type { ReactElement } from "react";
import { useForm, type FieldErrors, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/shared/auth/use-auth";
import { GitHubMark } from "@/shared/components/github-mark";
import { SiteFooter } from "@/shared/components/site-footer";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type LoginFormValues = { username: string; password: string };

type LoginFieldProps = {
  form: UseFormReturn<LoginFormValues>;
  name: "username" | "password";
  labelKey: string;
  type?: string;
  autoComplete: string;
  autoFocus?: boolean;
};

function createLoginSchema(t: Translate) {
  return z.object({
    username: z.string().min(1, t("auth.usernameRequired")),
    password: z.string().min(1, t("auth.passwordRequired")),
  });
}
/**
 * 登录页：顶部栏 + 宽屏介绍区 + 登录表单；表单状态由 LoginForm 自身持有。
 */
export function LoginPage(): ReactElement {
  return (
    <div data-testid="auth-login-page" className="flex min-h-screen flex-col bg-background">
      <LoginTopBar />

      <main className="mx-auto flex w-full max-w-[960px] flex-1 items-center justify-center px-5 py-12 sm:px-8 lg:px-0">
        <div className="grid w-full max-w-[840px] -translate-y-6 items-center lg:-translate-y-10 lg:grid-cols-[minmax(0,1fr)_1px_336px] lg:gap-14">
          <LoginIntro />

          <div className="hidden h-64 bg-border lg:block" aria-hidden="true" />

          <section className="w-full max-w-[336px] justify-self-center lg:justify-self-auto">
            <LoginFormHeading />
            <LoginForm />
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

/** 顶部栏：应用名与 GitHub 入口。 */
function LoginTopBar() {
  const { t } = useTranslation();
  return (
    <header className="mx-auto flex h-16 w-full max-w-[960px] items-center justify-between px-5 sm:px-8 lg:px-0">
      <span className="text-sm font-semibold text-foreground">{t("appName")}</span>
      <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" asChild>
        <a
          data-testid="auth-github-link"
          href="https://github.com/chenyme/grok2api"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
        >
          <GitHubMark />
        </a>
      </Button>
    </header>
  );
}

/** 宽屏左侧介绍区。 */
function LoginIntro() {
  const { t } = useTranslation();
  return (
    <section className="hidden min-h-72 flex-col justify-center lg:flex">
      <p className="text-xs font-medium text-muted-foreground">{t("appName")}</p>
      <h2 className="mt-3 max-w-sm text-3xl font-medium leading-tight">{t("auth.productTitle")}</h2>
      <p className="mt-4 max-w-xs text-xs leading-6 text-muted-foreground">{t("auth.subtitle")}</p>
    </section>
  );
}

/** 表单标题：窄屏下补充产品副标题。 */
function LoginFormHeading() {
  const { t } = useTranslation();
  return (
    <div className="mb-6">
      <h1 id="auth-login-title" data-testid="auth-login-title" className="text-xl font-medium">
        {t("auth.title")}
      </h1>
      <p className="mt-2 text-xs leading-5 text-muted-foreground lg:hidden">{t("auth.subtitle")}</p>
    </div>
  );
}

/** 登录输入项：用户名与密码共用标签、自动填充与错误态标记。 */
function LoginField({ form, name, labelKey, type, autoComplete, autoFocus }: LoginFieldProps) {
  const { t } = useTranslation();
  const error = form.formState.errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{t(labelKey)}</Label>
      <Input
        id={name}
        data-testid={`auth-${name}`}
        className="h-9 bg-card"
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `auth-${name}-error` : undefined}
        {...form.register(name)}
      />
      {error && (
        <p
          id={`auth-${name}-error`}
          data-testid={`auth-${name}-error`}
          className="text-xs text-destructive"
          role="alert"
        >
          {error.message}
        </p>
      )}
    </div>
  );
}

/** 登录表单：校验、提交与失败提示。 */
function LoginForm() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const form = useForm<LoginFormValues>({
    resolver: zodResolver(createLoginSchema(t)),
    defaultValues: { username: "", password: "" },
  });

  async function submit(values: LoginFormValues): Promise<void> {
    try {
      await login(values.username, values.password);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.generic"));
      form.setFocus("password");
    }
  }

  function invalid(errors: FieldErrors<LoginFormValues>): void {
    toast.error(errors.username?.message ?? errors.password?.message);
  }

  return (
    <form
      data-testid="auth-login-form"
      aria-labelledby="auth-login-title"
      className="space-y-4"
      onSubmit={form.handleSubmit(submit, invalid)}
    >
      <LoginField form={form} name="username" labelKey="auth.username" autoComplete="username" autoFocus />
      <LoginField
        form={form}
        name="password"
        labelKey="auth.password"
        type="password"
        autoComplete="current-password"
      />
      <Button
        data-testid="auth-login-submit"
        type="submit"
        size="sm"
        className="w-full"
        disabled={form.formState.isSubmitting}
      >
        {form.formState.isSubmitting ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
