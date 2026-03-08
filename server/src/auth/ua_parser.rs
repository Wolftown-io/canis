//! User-agent parsing for human-friendly device names.

use woothee::parser::Parser;

/// Parse a user-agent string into a friendly device name like "Chrome on Linux".
pub fn parse_device_name(user_agent: &str) -> String {
    let parser = Parser::new();
    match parser.parse(user_agent) {
        Some(result) => {
            let browser = result.name;
            let os = result.os;
            if os == "UNKNOWN" {
                browser.to_string()
            } else {
                format!("{browser} on {os}")
            }
        }
        None => "Unknown device".to_string(),
    }
}
