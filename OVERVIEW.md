# Claude and Codex auto resume

When a top-level Claude or Codex agent in Paseo stops with a recognized usage-limit message, this plugin waits until one minute after the stated reset time and sends a continuation prompt to the same agent. A new user turn or agent archive cancels the pending prompt. Each reset is attempted once.

The plugin observes agent timelines and sends a Korean continuation prompt through the local Paseo daemon. It does not access credentials or replay attachments. The Paseo daemon and plugin must stay running until the reset; pending timers do not survive a daemon restart or plugin reload. It recognizes Claude reset times labelled `Asia/Seoul` and Codex `try again at` times interpreted as Seoul time, within six hours. It starts handling new limit events after installation.
