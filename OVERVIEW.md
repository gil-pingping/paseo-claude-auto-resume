# Claude auto resume

When a top-level Claude agent in Paseo stops with the exact five-hour session-limit message, this plugin waits until one minute after the stated reset time and sends a continuation prompt to the same agent. A new user turn or agent archive cancels the pending prompt. Each reset is attempted once.

The plugin observes Claude agent timelines and sends a Korean continuation prompt through the local Paseo daemon. It does not access Claude credentials or replay attachments. The Paseo daemon and plugin must stay running until the reset; pending timers do not survive a daemon restart or plugin reload. It recognizes reset times labelled `Asia/Seoul` within six hours and starts handling new limit events after installation.
