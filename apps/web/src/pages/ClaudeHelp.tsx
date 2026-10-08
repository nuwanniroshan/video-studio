export function ClaudeHelp() {
  const code = (s: string) => <pre style={{ background: "#0D1020", color: "#E0E3FF", padding: "12px 14px", borderRadius: 10, overflow: "auto", fontSize: 12.5, margin: 0 }}>{s}</pre>;
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head"><div><h1>Make videos by asking Claude</h1><p>Claude can plan the storyboard, write the voice-over, check the frames and render, using this studio's tools. Videos it makes show up here.</p></div></div>
      <div className="card section">
        <h3>Claude Desktop</h3>
        <p className="muted" style={{ margin: 0 }}>Run once in the repo folder, then restart Claude Desktop:</p>
        {code("scripts/install-claude-desktop.sh")}
        <h3 style={{ marginTop: 10 }}>Claude Code</h3>
        <p className="muted" style={{ margin: 0 }}>Inside this repo the tools are available automatically. From any folder, install the plugin:</p>
        {code("/plugin marketplace add /Users/swiveltech/Disk/Swivel/video-studio\n/plugin install video-studio@video-studio-local")}
        <h3 style={{ marginTop: 10 }}>Then ask</h3>
        <p style={{ margin: 0 }}>“Make a 30-second launch video for our new leave-tracking feature for HR managers, ending with ‘Book a demo’, plus a vertical version for LinkedIn.”</p>
      </div>
    </div>
  );
}
