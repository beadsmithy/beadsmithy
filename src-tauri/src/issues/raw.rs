//! Raw mirror of Beadwork issue JSON objects.
//!
//! Internal to the adapter. This struct captures Beadwork's current JSON
//! schema from `bw list --all --json`, `bw ready --json`, and
//! `bw blocked --json` so the rest of the adapter never touches raw
//! [`serde_json::Value`]. It is deliberately not exported: the public adapter
//! API is [`super::adapter::Issue`], and raw field churn stays here.

use serde::Deserialize;

/// A single raw comment on a Beadwork issue.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RawComment {
    pub text: String,
    pub author: Option<String>,
    pub timestamp: String,
}

/// Raw Beadwork issue object returned by `bw list`, `bw ready`, and `bw blocked`.
///
/// Beadwork serializes Go `omitempty` fields by omitting them, so those are
/// [`Option`]. Slice fields are [`Option<Vec<..>>`] because Go marshals a nil
/// slice as `null` and an empty slice as `[]`; both normalize to an empty list
/// at the adapter boundary.
///
/// Detail-capable fields such as `description`, `comments`, and
/// `close_reason` stay optional here because older or sparse Beadwork JSON may
/// omit them; the adapter normalizes them into always-present Issue fields.
/// Blocked-only fields such as `open_blockers` are intentionally ignored.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RawIssue {
    pub assignee: String,
    #[serde(default)]
    pub blocked_by: Option<Vec<String>>,
    #[serde(default)]
    pub blocks: Option<Vec<String>>,
    pub closed_at: Option<String>,
    pub close_reason: Option<String>,
    pub created: String,
    pub defer_until: Option<String>,
    pub description: Option<String>,
    pub due: Option<String>,
    pub id: String,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
    pub parent: Option<String>,
    #[serde(default)]
    pub comments: Option<Vec<RawComment>>,
    pub priority: i64,
    pub status: String,
    pub title: String,
    #[serde(rename = "type")]
    pub issue_type: String,
    pub updated_at: Option<String>,
}
