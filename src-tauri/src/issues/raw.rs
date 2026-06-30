//! Raw mirror of `bw list --all --json` issue objects.
//!
//! Internal to the adapter. This struct captures Beadwork's current JSON
//! schema so the rest of the adapter never touches raw [`serde_json::Value`].
//! It is deliberately not exported: the public adapter API is
//! [`super::adapter::IssueSummary`], and raw field churn stays here.

use serde::Deserialize;

/// A single comment on a Beadwork issue. Only deserialized; never exposed.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct RawComment {
    pub text: String,
    pub author: Option<String>,
    pub timestamp: String,
}

/// Raw `bw list --all --json` issue object.
///
/// Beadwork serializes Go `omitempty` fields by omitting them, so those are
/// [`Option`]. Slice fields are [`Option<Vec<..>>`] because Go marshals a nil
/// slice as `null` and an empty slice as `[]`; both normalize to an empty list
/// at the adapter boundary.
///
/// Fields that the list adapter does not map into [`super::adapter::IssueSummary`]
/// are still deserialized so this struct mirrors the full Beadwork schema and
/// keeps parsing strict. They are intentionally unused.
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
    pub description: String,
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
