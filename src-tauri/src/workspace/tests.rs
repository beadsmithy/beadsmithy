//! Outlined Workspace Service tests.
//!
//! Migrated from the inline `mod tests` block at the bottom of `workspace.rs`.
//! The supporting fakes and command-output fixtures live at the root of this
//! file so the test bodies below can reuse them without widening the
//! production module's public surface.

use super::*;
use std::cell::RefCell;
use std::collections::VecDeque;

#[derive(Debug, Clone, PartialEq, Eq)]
struct Invocation {
    program: String,
    args: Vec<String>,
    cwd: PathBuf,
}

struct FakeRunner {
    outputs: RefCell<VecDeque<io::Result<CommandOutput>>>,
    invocations: RefCell<Vec<Invocation>>,
}

impl FakeRunner {
    fn with_outputs(outputs: impl IntoIterator<Item = io::Result<CommandOutput>>) -> Self {
        Self {
            outputs: RefCell::new(outputs.into_iter().collect()),
            invocations: RefCell::new(Vec::new()),
        }
    }

    fn success(stdout: &str) -> io::Result<CommandOutput> {
        Ok(CommandOutput {
            status: 0,
            stdout: stdout.to_string(),
            stderr: String::new(),
        })
    }

    fn invocations(&self) -> Vec<Invocation> {
        self.invocations.borrow().clone()
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, program: &str, args: &[&str], cwd: &Path) -> io::Result<CommandOutput> {
        self.invocations.borrow_mut().push(Invocation {
            program: program.to_string(),
            args: args
                .iter()
                .map(|argument| (*argument).to_string())
                .collect(),
            cwd: cwd.to_path_buf(),
        });
        self.outputs
            .borrow_mut()
            .pop_front()
            .expect("unexpected command invocation")
    }
}

struct FakeStore {
    load_result: RefCell<Result<Option<PersistedWorkspaceState>, String>>,
    save_results: RefCell<VecDeque<Result<(), String>>>,
    saved: RefCell<Vec<PersistedWorkspaceState>>,
    reset_result: RefCell<Result<(), String>>,
    reset_count: RefCell<usize>,
}

impl FakeStore {
    fn empty() -> Self {
        Self {
            load_result: RefCell::new(Ok(None)),
            save_results: RefCell::new(VecDeque::new()),
            saved: RefCell::new(Vec::new()),
            reset_result: RefCell::new(Ok(())),
            reset_count: RefCell::new(0),
        }
    }

    fn with_saves(save_results: impl IntoIterator<Item = Result<(), String>>) -> Self {
        Self {
            save_results: RefCell::new(save_results.into_iter().collect()),
            ..Self::empty()
        }
    }
}

#[derive(Clone, Default)]
struct PersistentTestStore {
    state: std::rc::Rc<RefCell<Option<PersistedWorkspaceState>>>,
}

impl WorkspaceStore for PersistentTestStore {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
        Ok(self.state.borrow().clone())
    }

    fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
        *self.state.borrow_mut() = Some(state.clone());
        Ok(())
    }

    fn reset(&self) -> Result<(), String> {
        *self.state.borrow_mut() = None;
        Ok(())
    }
}

/// A persistable store with an injectable failure queue, used to prove the
/// transactional guarantee for `WorkspaceStore::save` and `reset`. A failed
/// save does not mutate the persistent image, so a later `load` (or a fresh
/// `WorkspaceService::from_store` over the same handle) observes the prior
/// committed state — never the rejected proposal.
#[derive(Clone, Default)]
struct TransactingTestStore {
    state: std::rc::Rc<RefCell<Option<PersistedWorkspaceState>>>,
    failures: std::rc::Rc<RefCell<VecDeque<String>>>,
    /// Targeted failure: fails only the save call whose 1-indexed count
    /// matches the configured threshold, with the supplied message. Stored
    /// separately from `failures` so the two mechanisms cannot consume
    /// each other.
    fail_at_save: std::rc::Rc<RefCell<Option<(usize, String)>>>,
    save_attempts: std::rc::Rc<RefCell<usize>>,
    reset_attempts: std::rc::Rc<RefCell<usize>>,
}

impl TransactingTestStore {
    fn empty() -> Self {
        Self::default()
    }

    fn load_inner(&self) -> Option<PersistedWorkspaceState> {
        self.state.borrow().clone()
    }

    fn enqueue_failure(&self, error: impl Into<String>) {
        self.failures.borrow_mut().push_back(error.into());
    }

    /// Fail only the `n`-th save call (1-indexed). Other saves proceed
    /// normally. The targeted failure is independent of the FIFO failure
    /// queue.
    fn fail_nth_save(&self, n: usize, error: impl Into<String>) {
        *self.fail_at_save.borrow_mut() = Some((n, error.into()));
    }

    fn save_count(&self) -> usize {
        *self.save_attempts.borrow()
    }
}

impl WorkspaceStore for TransactingTestStore {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
        Ok(self.state.borrow().clone())
    }

    fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
        *self.save_attempts.borrow_mut() += 1;
        let current = *self.save_attempts.borrow();
        if let Some((threshold, message)) = self.fail_at_save.borrow().clone() {
            if current == threshold {
                return Err(message);
            }
        }
        if let Some(error) = self.failures.borrow_mut().pop_front() {
            return Err(error);
        }
        *self.state.borrow_mut() = Some(state.clone());
        Ok(())
    }

    fn reset(&self) -> Result<(), String> {
        *self.reset_attempts.borrow_mut() += 1;
        if let Some(error) = self.failures.borrow_mut().pop_front() {
            // Failed reset must leave the prior durable image in place.
            return Err(error);
        }
        *self.state.borrow_mut() = None;
        Ok(())
    }
}

impl WorkspaceStore for FakeStore {
    fn load(&self) -> Result<Option<PersistedWorkspaceState>, String> {
        self.load_result.borrow().clone()
    }

    fn save(&self, state: &PersistedWorkspaceState) -> Result<(), String> {
        let result = self.save_results.borrow_mut().pop_front().unwrap_or(Ok(()));
        if result.is_ok() {
            self.saved.borrow_mut().push(state.clone());
        }
        result
    }

    fn reset(&self) -> Result<(), String> {
        *self.reset_count.borrow_mut() += 1;
        self.reset_result.borrow().clone()
    }
}

fn command_outputs(root: &str) -> Vec<io::Result<CommandOutput>> {
    vec![
        FakeRunner::success("setting=value\n"),
        FakeRunner::success(&format!("{root}\n")),
        FakeRunner::success("[]"),
        FakeRunner::success("[]"),
        FakeRunner::success("[]"),
    ]
}

#[test]
fn validates_with_explicit_candidate_cwd_and_normalizes_git_root() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs(command_outputs("/work/repo/subdir/.."));
    let candidate = Path::new("/work/repo/subdir");

    service
        .select_workspace(&runner, candidate)
        .expect("selection should succeed");

    assert_eq!(
        runner.invocations(),
        vec![
            Invocation {
                program: "bw".to_string(),
                args: vec!["config".to_string(), "list".to_string()],
                cwd: candidate.to_path_buf(),
            },
            Invocation {
                program: "git".to_string(),
                args: vec!["rev-parse".to_string(), "--show-toplevel".to_string()],
                cwd: candidate.to_path_buf(),
            },
            Invocation {
                program: "bw".to_string(),
                args: vec![
                    "list".to_string(),
                    "--all".to_string(),
                    "--json".to_string()
                ],
                cwd: PathBuf::from("/work/repo"),
            },
            Invocation {
                program: "bw".to_string(),
                args: vec!["ready".to_string(), "--json".to_string()],
                cwd: PathBuf::from("/work/repo"),
            },
            Invocation {
                program: "bw".to_string(),
                args: vec!["blocked".to_string(), "--json".to_string()],
                cwd: PathBuf::from("/work/repo"),
            },
        ]
    );
    assert_eq!(
        service.state().current_workspace,
        Some(Workspace {
            path: "/work/repo".to_string(),
            availability: WorkspaceAvailability::Available,
        })
    );
}

#[test]
fn startup_restore_is_provisional_until_validation_and_load_succeed() {
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
        catalog: vec![Workspace {
            path: "/work/remembered".to_string(),
            availability: WorkspaceAvailability::Available,
        }],
        current_workspace_path: Some("/work/remembered".to_string()),
        ..PersistedWorkspaceState::default()
    }));
    let mut service = WorkspaceService::from_store(store);

    assert!(service.state().current_workspace.is_none());
    assert_eq!(service.state().catalog[0].path, "/work/remembered");

    let runner = FakeRunner::with_outputs(command_outputs("/work/remembered"));
    let data = service
        .restore_current(&runner)
        .expect("restoration should succeed")
        .expect("remembered workspace should be restored");

    assert!(data.all_issues.is_empty());
    assert_eq!(
        service.state().current_workspace,
        Some(Workspace {
            path: "/work/remembered".to_string(),
            availability: WorkspaceAvailability::Available,
        })
    );
}

#[test]
fn invalid_startup_restore_remains_known_but_never_becomes_current() {
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
        catalog: vec![Workspace {
            path: "/work/remembered".to_string(),
            availability: WorkspaceAvailability::Available,
        }],
        current_workspace_path: Some("/work/remembered".to_string()),
        ..PersistedWorkspaceState::default()
    }));
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs([Ok(CommandOutput {
        status: 1,
        stdout: String::new(),
        stderr: "beadwork not initialized".to_string(),
    })]);

    let error = service
        .restore_current(&runner)
        .expect_err("invalid remembered workspace should not restore");

    assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
    assert!(service.state().current_workspace.is_none());
    assert_eq!(service.state().catalog[0].path, "/work/remembered");
}

#[test]
fn true_empty_views_publish_a_current_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs(command_outputs("/work/empty"));

    let data = service
        .select_workspace(&runner, "/work/empty")
        .expect("empty workspace is valid");

    assert!(data.all_issues.is_empty());
    assert!(data.ready_issues.is_empty());
    assert!(data.blocked_issues.is_empty());
    assert_eq!(
        service
            .state()
            .current_workspace
            .as_ref()
            .map(|workspace| &workspace.path),
        Some(&"/work/empty".to_string())
    );
}

#[test]
fn validation_failure_preserves_existing_current_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let failed = FakeRunner::with_outputs([Ok(CommandOutput {
        status: 1,
        stdout: String::new(),
        stderr: "beadwork not initialized".to_string(),
    })]);
    let error = service
        .select_workspace(&failed, "/work/invalid")
        .expect_err("validation should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
    assert_eq!(
        service
            .state()
            .current_workspace
            .as_ref()
            .map(|workspace| &workspace.path),
        Some(&"/work/first".to_string())
    );
    assert!(service.state().pending_workspace.is_none());
}

#[test]
fn first_catalog_save_failure_discards_validated_candidate() {
    let store = FakeStore::with_saves([Err("disk full".to_string())]);
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/repo\n"),
    ]);

    let error = service
        .select_workspace(&runner, "/work/repo")
        .expect_err("catalog save should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
    assert!(service.state().catalog.is_empty());
    assert!(service.state().current_workspace.is_none());
    assert!(service.state().pending_workspace.is_none());
}

#[test]
fn post_validation_load_failure_keeps_known_candidate_without_mru_promotion() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let second = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "failed to load issues".to_string(),
        }),
    ]);
    let error = service
        .select_workspace(&second, "/work/second")
        .expect_err("issue load should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::LoadFailed);
    assert_eq!(
        service.state().current_workspace,
        Some(Workspace {
            path: "/work/first".to_string(),
            availability: WorkspaceAvailability::Available,
        })
    );
    assert_eq!(
        service
            .state()
            .catalog
            .iter()
            .map(|workspace| workspace.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first", "/work/second"]
    );
    assert!(service.state().pending_workspace.is_none());
}

#[test]
fn final_save_failure_does_not_publish_loaded_workspace() {
    let store = FakeStore::with_saves([Ok(()), Err("disk full".to_string())]);
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs(command_outputs("/work/repo"));

    let error = service
        .select_workspace(&runner, "/work/repo")
        .expect_err("final save should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
    assert!(service.state().current_workspace.is_none());
    assert_eq!(service.state().catalog.len(), 1);
    assert_eq!(service.state().catalog[0].path, "/work/repo");
    assert!(service.state().pending_workspace.is_none());
    assert_eq!(service.state().error, Some(error));
}

#[test]
fn stale_generation_does_not_run_commands_or_save() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let stale = service.begin_selection("/work/first");
    let current = service.begin_selection("/work/second");
    let runner = FakeRunner::with_outputs(command_outputs("/work/second"));

    let error = service
        .complete_selection(&runner, stale)
        .expect_err("old request should be rejected");
    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    assert!(runner.invocations().is_empty());

    service
        .complete_selection(&runner, current)
        .expect("new request should still succeed");
    assert_eq!(service.state().generation, 2);
    assert_eq!(
        service.state().current_workspace.as_ref().unwrap().path,
        "/work/second"
    );
}

#[test]
fn reset_explicitly_recovers_from_unreadable_memory() {
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Err("invalid JSON".to_string());
    let mut service = WorkspaceService::from_store(store);

    assert_eq!(
        service.state().error.as_ref().map(|error| &error.kind),
        Some(&WorkspaceErrorKind::StoreReadFailed)
    );
    service.reset_memory().expect("reset should succeed");
    assert!(service.state().error.is_none());
    assert!(service.state().catalog.is_empty());
    assert!(service.state().current_workspace.is_none());
}

#[test]
fn catalog_is_capped_at_one_hundred_entries() {
    let mut persisted = PersistedWorkspaceState::default();
    persisted.catalog = (0..100)
        .map(|index| Workspace {
            path: format!("/work/{index}"),
            availability: WorkspaceAvailability::Available,
        })
        .collect();
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Ok(Some(persisted));
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs(command_outputs("/work/new"));

    service
        .select_workspace(&runner, "/work/new")
        .expect("selection should succeed");

    assert_eq!(service.state().catalog.len(), 100);
    assert_eq!(service.state().catalog[0].path, "/work/new");
    assert!(!service
        .state()
        .catalog
        .iter()
        .any(|workspace| workspace.path == "/work/99"));
}

#[test]
fn persisted_current_restores_through_the_backend_store_on_restart() {
    let store = PersistentTestStore::default();
    WorkspaceService::from_store(store.clone())
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/persisted")),
            "/work/persisted",
        )
        .expect("initial selection should durably save");

    let mut restarted = WorkspaceService::from_store(store);
    assert!(restarted.state().current_workspace.is_none());
    restarted
        .restore_current(&FakeRunner::with_outputs(command_outputs(
            "/work/persisted",
        )))
        .expect("restart should restore through the normal transaction");
    assert_eq!(
        restarted
            .state()
            .current_workspace
            .as_ref()
            .map(|workspace| &workspace.path),
        Some(&"/work/persisted".to_string())
    );
}

#[test]
fn missing_catalog_path_is_unavailable_but_remains_known() {
    let path = std::env::temp_dir().join(format!(
        "beadsmith-missing-workspace-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&path);
    let path_string = path.display().to_string();
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
        catalog: vec![Workspace {
            path: path_string,
            availability: WorkspaceAvailability::Available,
        }],
        ..PersistedWorkspaceState::default()
    }));

    let service = WorkspaceService::from_store(store);

    assert_eq!(service.state().catalog.len(), 1);
    assert_eq!(
        service.state().catalog[0].availability,
        WorkspaceAvailability::Unavailable
    );
}

#[test]
fn availability_is_derived_from_path_access_not_validation_failure() {
    let path = std::env::temp_dir().join(format!(
        "beadsmith-readable-workspace-{}",
        std::process::id()
    ));
    std::fs::create_dir_all(&path).expect("temporary directory should be created");
    let path_string = path.display().to_string();
    let store = FakeStore::empty();
    *store.load_result.borrow_mut() = Ok(Some(PersistedWorkspaceState {
        catalog: vec![Workspace {
            path: path_string.clone(),
            availability: WorkspaceAvailability::Unavailable,
        }],
        current_workspace_path: Some(path_string),
        ..PersistedWorkspaceState::default()
    }));
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs([Ok(CommandOutput {
        status: 1,
        stdout: String::new(),
        stderr: "not a Beadwork workspace".to_string(),
    })]);

    service
        .restore_current(&runner)
        .expect_err("invalid workspace must not restore");

    assert!(service.state().current_workspace.is_none());
    assert_eq!(
        service.state().catalog[0].availability,
        WorkspaceAvailability::Available
    );
    std::fs::remove_dir_all(path).expect("temporary directory should be removed");
}

#[test]
fn removing_current_clears_it_without_selecting_another_catalog_entry() {
    let mut service = WorkspaceService::from_store(FakeStore::empty());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect("second selection should succeed");

    service
        .remove_workspace("/work/second")
        .expect("removal should persist");

    assert!(service.state().current_workspace.is_none());
    assert_eq!(service.state().catalog[0].path, "/work/first");
    assert!(service.state().pending_workspace.is_none());
}

#[test]
fn validation_and_load_failure_retains_without_promoting_until_retry_succeeds() {
    let mut service = WorkspaceService::from_store(FakeStore::empty());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");
    service
        .select_workspace(
            &FakeRunner::with_outputs([
                FakeRunner::success("setting=value\n"),
                FakeRunner::success("/work/second\n"),
                Ok(CommandOutput {
                    status: 2,
                    stdout: String::new(),
                    stderr: "load failed".to_string(),
                }),
            ]),
            "/work/second",
        )
        .expect_err("failed load must not promote");
    assert_eq!(
        service
            .state()
            .catalog
            .iter()
            .map(|workspace| workspace.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first", "/work/second"]
    );

    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect("successful retry should promote");
    assert_eq!(
        service
            .state()
            .catalog
            .iter()
            .map(|workspace| workspace.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/second", "/work/first"]
    );
}

#[test]
fn cancel_pending_drops_pending_workspace_and_bumps_generation() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let second = FakeRunner::with_outputs(command_outputs("/work/second"));
    let request = service.begin_selection("/work/second");
    // First selection committed at gen 1, second begin bumps to gen 2.
    assert_eq!(service.state().generation, 2);
    assert_eq!(
        service
            .state()
            .pending_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/second")
    );

    let returned = service.cancel_pending();
    assert_eq!(returned.generation, 3);
    assert!(returned.pending_workspace.is_none());
    assert!(returned.error.is_none());
    assert_eq!(
        returned.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first")
    );
    // The catalog reflects the persisted prior workspace, not pending.
    assert_eq!(
        returned
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first"]
    );
    // Late resolution of the cancelled request is silently rejected.
    let error = service
        .complete_selection(&second, request)
        .expect_err("cancelled request must not publish");
    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    assert_eq!(service.state().generation, 3);
    assert_eq!(
        service
            .state()
            .current_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/first")
    );

    service
        .select_workspace(&second, "/work/second")
        .expect("fresh request after cancel should still succeed");
    // 1 (first select) + 1 (cancelled second) + 1 (third begin) commits 4.
    assert_eq!(service.state().generation, 4);
}

#[test]
fn cancel_pending_with_no_pending_workspace_is_a_noop() {
    // Cancel-after-commit-before-success-publication safety: when there
    // is no actual pending request to cancel, the generation must not
    // bump. Bumping would race the in-flight success transition for the
    // just-committed request and let the renderer reject the success
    // transition as "older than accepted", leaving B Current paired
    // with A's snapshot.
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let before = service.state().generation;
    let returned = service.cancel_pending();
    assert_eq!(
        returned.generation, before,
        "cancel_pending without a pending request must not bump the generation"
    );
    assert!(returned.pending_workspace.is_none());
    assert_eq!(
        returned.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first")
    );
}

#[test]
fn cancel_pending_with_no_current_clears_pending_only() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let request = service.begin_selection("/work/first");
    assert!(service.state().pending_workspace.is_some());

    let returned = service.cancel_pending();
    assert!(returned.current_workspace.is_none());
    assert!(returned.pending_workspace.is_none());
    assert!(returned.error.is_none());
    // Catalog is unchanged: nothing durable was written before cancel.
    assert!(returned.catalog.is_empty());

    // The cancelled request still rejects late results.
    let runner = FakeRunner::with_outputs(command_outputs("/work/first"));
    let error = service
        .complete_selection(&runner, request)
        .expect_err("cancelled request must not publish");
    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
}

#[test]
fn cancel_pending_after_known_candidate_failure_only_clears_pending() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let second = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&second, "/work/second")
        .expect_err("load failure should not promote");

    // After a load failure the known candidate stays in the catalog,
    // error is surfaced, and pending is None.
    assert_eq!(
        service
            .state()
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first", "/work/second"]
    );
    assert_eq!(
        service.state().error.as_ref().map(|e| e.kind.clone()),
        Some(WorkspaceErrorKind::LoadFailed)
    );

    let returned = service.cancel_pending();
    // The retryable catalog entry survives Cancel — Cancel does not
    // remove the known target.
    assert_eq!(
        returned
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first", "/work/second"]
    );
    assert!(returned.error.is_none());
    assert!(returned.pending_workspace.is_none());
    assert_eq!(
        returned.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first")
    );
}

#[test]
fn cancel_pending_after_commit_does_not_bump_generation() {
    // Reproduces the bsm-kia.7 cancel-after-final-commit-before-success-
    // publication race: the user-visible commit has already landed in
    // `self.state` (current=B), but Taurpc has not yet published the
    // typed success transition. A Cancel that races the success
    // publication must not bump the generation; otherwise the renderer
    // would reject the in-flight success transition as "older than
    // accepted" and show B Current paired with A's snapshot.
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");
    let before = service.state().generation;

    // Successful switch to B commits (current=B, generation stays the
    // request's generation), then the user-visible Pending window has
    // already cleared because Phase 5 ran commit_loaded.
    let second = FakeRunner::with_outputs(command_outputs("/work/second"));
    service
        .select_workspace(&second, "/work/second")
        .expect("second switch should succeed");
    assert_eq!(
        service
            .state()
            .current_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/second")
    );
    assert!(
        service.state().pending_workspace.is_none(),
        "commit clears pending; the success transition is what has not yet been published"
    );

    // The Cancel arrives between commit and success publication. It
    // must not bump the generation, otherwise the in-flight success
    // transition would be rejected at the renderer as older than
    // accepted.
    let returned = service.cancel_pending();
    assert_eq!(
        returned.generation,
        before + 1,
        "cancel_pending after a successful commit must not bump the generation"
    );
    assert_eq!(
        returned.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second"),
        "current must remain the just-committed B"
    );
    assert!(
        returned.pending_workspace.is_none(),
        "no pending workspace was set by Cancel"
    );
}

#[test]
fn post_validation_load_failure_sets_retry_workspace_to_validated_candidate() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let second = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    let error = service
        .select_workspace(&second, "/work/second")
        .expect_err("load failure should not promote");

    assert_eq!(error.kind, WorkspaceErrorKind::LoadFailed);
    let state = service.state();
    assert_eq!(
        state.retry_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second"),
        "retry_workspace must surface the validated candidate for Retry"
    );
    assert_eq!(
        state.error.as_ref().map(|e| e.kind.clone()),
        Some(WorkspaceErrorKind::LoadFailed)
    );
    assert!(state.pending_workspace.is_none());
}

#[test]
fn final_save_failure_sets_retry_workspace_to_validated_candidate() {
    let store = FakeStore::with_saves([Ok(()), Err("disk full".to_string())]);
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs(command_outputs("/work/repo"));

    let error = service
        .select_workspace(&runner, "/work/repo")
        .expect_err("final save should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
    let state = service.state();
    assert_eq!(
        state.retry_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/repo"),
        "retry_workspace must survive a final-save failure so Retry can replay"
    );
}

#[test]
fn validation_failure_does_not_set_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs([Ok(CommandOutput {
        status: 1,
        stdout: String::new(),
        stderr: "beadwork not initialized".to_string(),
    })]);

    let error = service
        .select_workspace(&runner, "/work/invalid")
        .expect_err("validation should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::ValidationFailed);
    let state = service.state();
    assert!(
        state.retry_workspace.is_none(),
        "no validated candidate exists for Retry when validation itself fails"
    );
}

#[test]
fn git_root_failure_does_not_set_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let runner = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        Ok(CommandOutput {
            status: 128,
            stdout: String::new(),
            stderr: "fatal: not a git repository".to_string(),
        }),
    ]);

    let error = service
        .select_workspace(&runner, "/work/notgit")
        .expect_err("git root should fail");

    assert_eq!(error.kind, WorkspaceErrorKind::GitRootFailed);
    let state = service.state();
    assert!(state.retry_workspace.is_none());
}

#[test]
fn begin_selection_clears_a_previous_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    // Cause a load failure so retry_workspace is set on /work/second.
    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");
    assert_eq!(
        service
            .state()
            .retry_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/second")
    );

    // A new selection must supersede the previous retry target.
    let _request = service.begin_selection("/work/third");
    assert!(
        service.state().retry_workspace.is_none(),
        "a new begin_selection must clear the previous retry target"
    );
    assert!(service.state().pending_workspace.is_some());
}

#[test]
fn cancel_pending_clears_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    // Force a load failure on second so retry_workspace is set.
    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");
    assert!(service.state().retry_workspace.is_some());

    let returned = service.cancel_pending();
    assert!(
        returned.retry_workspace.is_none(),
        "cancel must clear the retryable banner target"
    );
}

#[test]
fn remove_workspace_clears_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    // Force a load failure on second so retry_workspace is set on /work/second.
    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");
    assert!(service.state().retry_workspace.is_some());

    service
        .remove_workspace("/work/second")
        .expect("removal should succeed");

    assert!(
        service.state().retry_workspace.is_none(),
        "removal must clear any retryable target"
    );
    assert!(service.state().error.is_none());
}

#[test]
fn reset_memory_clears_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");
    assert!(service.state().retry_workspace.is_some());

    service.reset_memory().expect("reset should succeed");

    assert!(
        service.state().retry_workspace.is_none(),
        "reset must clear the retryable banner target"
    );
    assert!(service.state().error.is_none());
    assert!(service.state().catalog.is_empty());
    assert!(service.state().current_workspace.is_none());
}

#[test]
fn successful_commit_clears_retry_workspace() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    // Establish a retry target on /work/second via load failure.
    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");
    assert!(service.state().retry_workspace.is_some());

    // A successful commit for any candidate must clear the stale retry target.
    let third = FakeRunner::with_outputs(command_outputs("/work/third"));
    service
        .select_workspace(&third, "/work/third")
        .expect("third selection should succeed");

    assert!(
        service.state().retry_workspace.is_none(),
        "a successful commit must clear any stale retry target"
    );
}

#[test]
fn retry_replays_validated_candidate_and_promotes_on_success() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    // First attempt: load fails, retry target is set to /work/second.
    let failed = FakeRunner::with_outputs([
        FakeRunner::success("setting=value\n"),
        FakeRunner::success("/work/second\n"),
        Ok(CommandOutput {
            status: 2,
            stdout: String::new(),
            stderr: "load failed".to_string(),
        }),
    ]);
    service
        .select_workspace(&failed, "/work/second")
        .expect_err("load failure should not promote");

    let retry_target = service
        .state()
        .retry_workspace
        .clone()
        .expect("retry target must be set after post-validation failure");
    assert_eq!(retry_target.path, "/work/second");

    // Retry replays the validated candidate with a fresh generation.
    let retry_runner = FakeRunner::with_outputs(command_outputs("/work/second"));
    service
        .select_workspace(&retry_runner, &retry_target.path)
        .expect("retry should succeed");

    let state = service.state();
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second")
    );
    assert!(state.retry_workspace.is_none());
    assert!(state.pending_workspace.is_none());
    assert!(state.error.is_none());
    // The catalog reflects MRU promotion: second is now first.
    assert_eq!(
        state
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/second", "/work/first"]
    );
}

#[test]
fn stale_cancellation_completion_does_not_set_error_or_retry() {
    // Simulates: user starts switch A→B, then selects C while B is
    // loading. B's late completion must not surface as a banner or
    // create a stale retry target.
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let cancelled = service.begin_selection("/work/second");
    let _superseding = service.begin_selection("/work/third");
    let runner = FakeRunner::with_outputs(command_outputs("/work/second"));

    let error = service
        .complete_selection(&runner, cancelled)
        .expect_err("cancelled request must not publish");

    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    let state = service.state();
    assert!(
        state.retry_workspace.is_none(),
        "stale completions must not seed a retry target"
    );
    assert!(
        state.error.is_none(),
        "stale completions must not overwrite the current error or seed one"
    );
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first")
    );
}

#[test]
fn removing_current_while_pending_clears_current_and_invalidates_pending() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let second = FakeRunner::with_outputs(command_outputs("/work/second"));
    service
        .select_workspace(&second, "/work/second")
        .expect("second selection should succeed");

    let _pending = service.begin_selection("/work/pending");
    assert!(service.state().pending_workspace.is_some());

    service
        .remove_workspace("/work/second")
        .expect("removal of current should persist");

    let state = service.state();
    assert!(
        state.current_workspace.is_none(),
        "removing Current clears it without selecting another catalog entry"
    );
    assert!(
        state.pending_workspace.is_none(),
        "removing any workspace invalidates an in-flight pending request"
    );
    assert!(state.retry_workspace.is_none());
    // Catalog no longer contains the removed entry, but still has /work/first.
    assert_eq!(
        state
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first"]
    );
}

#[test]
fn removing_pending_workspace_invalidates_pending_without_selecting_another() {
    let store = FakeStore::empty();
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let _request = service.begin_selection("/work/pending");
    assert_eq!(
        service
            .state()
            .pending_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/pending")
    );

    service
        .remove_workspace("/work/pending")
        .expect("removing the pending target should succeed");

    let state = service.state();
    assert!(
        state.pending_workspace.is_none(),
        "removing the Pending target must invalidate it"
    );
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first"),
        "Current must remain unchanged when removing only the Pending target"
    );
    assert!(state.retry_workspace.is_none());
    assert_eq!(
        state
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first"],
        "the removed pending target must not remain in the catalog"
    );
}

#[test]
fn retain_validated_phase_persists_without_promoting_mru() {
    let store = FakeStore::with_saves([Ok(()), Ok(())]);
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");
    // After the first select_workspace the save_results queue has two
    // successful saves remaining (catalog retain + final commit).

    let request = service.begin_selection("/work/second");
    let validated = Workspace {
        path: "/work/second".to_string(),
        availability: WorkspaceAvailability::Available,
    };

    service
        .retain_validated(&request, validated.clone())
        .expect("retain should succeed");

    let state = service.state();
    assert_eq!(
        state.pending_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second")
    );
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first"),
        "Current must remain A until the final commit phase"
    );
    assert_eq!(
        state
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/first", "/work/second"],
        "catalog retain does not promote MRU order"
    );
}

#[test]
fn retain_validated_phase_rejects_stale_generation() {
    let store = FakeStore::with_saves([Ok(())]);
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");
    // After the first select_workspace the save_results queue is empty;
    // any stale save attempt would panic if it ran.

    let stale = service.begin_selection("/work/stale");
    let _superseding = service.begin_selection("/work/newer");
    let validated = Workspace {
        path: "/work/stale".to_string(),
        availability: WorkspaceAvailability::Available,
    };

    let error = service
        .retain_validated(&stale, validated)
        .expect_err("stale retain must fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
}

#[test]
fn commit_loaded_phase_publishes_current_and_promotes_mru() {
    let store = FakeStore::with_saves([Ok(()), Ok(()), Ok(())]);
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let request = service.begin_selection("/work/second");
    let validated = Workspace {
        path: "/work/second".to_string(),
        availability: WorkspaceAvailability::Available,
    };
    service
        .retain_validated(&request, validated.clone())
        .expect("retain should succeed");

    let data = IssueExplorerData {
        all_issues: Vec::new(),
        ready_issues: Vec::new(),
        blocked_issues: Vec::new(),
    };
    let returned = service
        .commit_loaded(&request, validated.clone(), data.clone())
        .expect("commit should succeed");
    assert_eq!(returned, data);

    let state = service.state();
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second")
    );
    assert!(state.pending_workspace.is_none());
    assert_eq!(
        state
            .catalog
            .iter()
            .map(|w| w.path.as_str())
            .collect::<Vec<_>>(),
        vec!["/work/second", "/work/first"],
        "commit must promote MRU order"
    );
    assert!(state.retry_workspace.is_none());
    assert!(state.error.is_none());
}

#[test]
fn commit_loaded_phase_rejects_stale_generation() {
    let store = FakeStore::with_saves([Ok(()), Ok(())]);
    let mut service = WorkspaceService::from_store(store);
    let first = FakeRunner::with_outputs(command_outputs("/work/first"));
    service
        .select_workspace(&first, "/work/first")
        .expect("first selection should succeed");

    let stale = service.begin_selection("/work/second");
    let _superseding = service.begin_selection("/work/newer");
    let validated = Workspace {
        path: "/work/second".to_string(),
        availability: WorkspaceAvailability::Available,
    };
    // Skip retain_validated (would have failed too).
    let data = IssueExplorerData {
        all_issues: Vec::new(),
        ready_issues: Vec::new(),
        blocked_issues: Vec::new(),
    };

    let error = service
        .commit_loaded(&stale, validated, data)
        .expect_err("stale commit must fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StaleGeneration);
    assert_eq!(
        service
            .state()
            .current_workspace
            .as_ref()
            .map(|w| w.path.as_str()),
        Some("/work/first"),
        "Current must remain A when the commit phase is stale"
    );
}

// ---------------------------------------------------------------------------
// bsm-njq.1 — Transactional failure-boundary tests
//
// A failed persistence operation must leave both service memory and the
// durable store image at the previously committed value, so a later save,
// reset, auto-save, or fresh load cannot republish the rejected mutation.
// ---------------------------------------------------------------------------

#[test]
fn transactional_store_failed_save_leaves_prior_state_durable() {
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());

    // Commit A so the durable image holds A.
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");
    let committed_first = store
        .load_inner()
        .expect("first selection should be durable");
    assert_eq!(
        committed_first.current_workspace_path.as_deref(),
        Some("/work/first")
    );

    // Queue a failure for the validated-candidate save of B.
    store.enqueue_failure("disk full".to_string());
    let error = service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect_err("candidate save should fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);

    // The durable image must still be the previously committed A; no part
    // of the rejected B catalog mutation may have been published.
    let after_failure = store
        .load_inner()
        .expect("durable image must still exist after a failed save");
    assert_eq!(
        after_failure.current_workspace_path.as_deref(),
        Some("/work/first"),
        "rejected B must not become Current durably"
    );
    assert_eq!(after_failure.catalog.len(), 1);
    assert_eq!(after_failure.catalog[0].path, "/work/first");
}

#[test]
fn transactional_store_failed_validated_candidate_save_leaves_prior_state_durable() {
    // Validated-candidate save failure: `retain_validated` is the first
    // commit phase and its `commit_proposed` save is the only one attempted
    // (issue-load and `commit_loaded` are skipped). A retryable
    // `storeSaveFailed` must leave the previously committed Current and
    // catalog authoritative; the validated candidate and any partial
    // catalog mutation must not survive the failure, and a follow-up load
    // observes only the prior committed state.
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    // Fail the validated-candidate save. Only one failure is consumed
    // because `commit_proposed` inside `retain_validated` is the first
    // and only save attempted for this transaction — the issue-load
    // and `commit_loaded` phases are skipped once retain_validated fails.
    store.enqueue_failure("disk full".to_string());
    let error = service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect_err("validated-candidate save should fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);

    // Durable image unchanged.
    let durable = store.load_inner().expect("durable image must survive");
    assert_eq!(
        durable.current_workspace_path.as_deref(),
        Some("/work/first"),
        "old Current must remain authoritative after a failed validated-candidate save"
    );
    assert_eq!(durable.catalog.len(), 1);
    assert_eq!(durable.catalog[0].path, "/work/first");

    // A fresh load simulates restart: only the prior committed state loads.
    let reloaded = WorkspaceService::from_store(store.clone());
    let provisional = reloaded.state();
    assert!(
        provisional.current_workspace.is_none(),
        "fresh load must not pre-publish Current; restore_current will validate"
    );
    assert_eq!(provisional.catalog.len(), 1);
    assert_eq!(provisional.catalog[0].path, "/work/first");
    assert_eq!(
        provisional.error.as_ref().map(|e| &e.kind),
        None,
        "load itself is successful; only the proposed save failed"
    );
}

#[test]
fn transactional_store_failed_final_save_leaves_old_current_authoritative() {
    // Final-save failure: `retain_validated` succeeds and durably extends
    // the catalog with the validated candidate, but the second
    // `commit_proposed` inside `commit_loaded` (the Current/MRU save)
    // fails. The old Current must remain authoritative; the validated
    // candidate's catalog entry must survive the failure because it was
    // durably committed in `retain_validated`; the service must surface
    // `storeSaveFailed` with the candidate exposed via `retry_workspace`;
    // and a follow-up load must observe the catalog extension without a
    // promoted Current.
    //
    // `select_workspace` issues two save calls per transaction (one each
    // from `retain_validated` and `commit_loaded`). `fail_nth_save(4, _)`
    // lets the first three saves through (initial-load setup + retained
    // B) and only fails the fourth (commit_loaded's Current/MRU save),
    // which is exactly the boundary under test.
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    // Saves 3 (retain_validated for B) and 4 (commit_loaded for B) are
    // about to be called. We want save 3 to succeed and save 4 to fail.
    store.fail_nth_save(4, "disk still full".to_string());
    let error = service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect_err("final save should fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);
    assert_eq!(store.save_count(), 4);

    // Durable catalog must reflect BOTH workspaces, because the validated
    // candidate retention was durably committed before the final save
    // failed. Current must remain A: the failed final-save left no
    // promotion behind.
    let durable = store
        .load_inner()
        .expect("durable image must survive a failed final save");
    assert_eq!(
        durable.current_workspace_path.as_deref(),
        Some("/work/first"),
        "old Current must remain authoritative after a failed final save"
    );
    assert_eq!(
        durable.catalog.len(),
        2,
        "validated candidate must have been durably committed before the final save"
    );
    let catalog_paths: Vec<&str> = durable.catalog.iter().map(|w| w.path.as_str()).collect();
    assert_eq!(catalog_paths, vec!["/work/first", "/work/second"]);

    // Service state mirrors the durable view: Current stays A, the
    // validated candidate is surfaced for Retry because the failure was a
    // post-validation final save.
    let state = service.state();
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first"),
        "service Current must remain A after a failed final B save"
    );
    assert_eq!(
        state.retry_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second"),
        "Retry must still expose the validated candidate after a final-save failure"
    );

    // A fresh load simulates restart: only the prior committed durable
    // state loads, with B retained as a known candidate and A as the
    // provisional Current Pending restore_current validation.
    let reloaded = WorkspaceService::from_store(store.clone());
    let provisional = reloaded.state();
    assert!(
        provisional.current_workspace.is_none(),
        "fresh load must not pre-publish Current; restore_current will validate"
    );
    assert_eq!(provisional.catalog.len(), 2);
    let provisional_paths: Vec<&str> = provisional
        .catalog
        .iter()
        .map(|w| w.path.as_str())
        .collect();
    assert_eq!(provisional_paths, vec!["/work/first", "/work/second"]);
    assert_eq!(
        provisional.error.as_ref().map(|e| &e.kind),
        None,
        "load itself is successful; only the proposed final save failed"
    );
}

#[test]
fn transactional_store_successful_save_after_failure_does_not_resurrect_rejected() {
    // After a failed save of B, a successful save of C must persist C
    // atomically. The rejected B must not have been partially published
    // between the failed B and the successful C.
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    store.enqueue_failure("transient".to_string());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect_err("second save should fail");

    // Now successfully commit C. The durable image must reflect C — the
    // rejected B must not have been published and then overwritten. We
    // observe only the final committed state.
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/third")),
            "/work/third",
        )
        .expect("third save should succeed");
    let durable = store.load_inner().expect("durable image must exist");
    assert_eq!(
        durable.current_workspace_path.as_deref(),
        Some("/work/third"),
        "successful save after a failure must persist the new state"
    );
    assert_eq!(durable.catalog.len(), 2);
    assert_eq!(durable.catalog[0].path, "/work/third");
    assert_eq!(durable.catalog[1].path, "/work/first");
}

#[test]
fn transactional_store_failed_reset_leaves_prior_state_durable() {
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    // Fail the reset.
    store.enqueue_failure("disk full".to_string());
    let error = service
        .reset_memory()
        .expect_err("reset must fail without persisting");
    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);

    // The durable image must still hold the previously committed catalog and
    // Current — the failed reset must not leave an unintended cleared or
    // partial catalog durable.
    let durable = store.load_inner().expect("durable image must survive");
    assert_eq!(
        durable.current_workspace_path.as_deref(),
        Some("/work/first"),
        "failed reset must not clear or null Current durably"
    );
    assert_eq!(durable.catalog.len(), 1);
    assert_eq!(durable.catalog[0].path, "/work/first");
}

#[test]
fn transactional_store_successful_reset_after_failure_clears_state() {
    // After a failed reset, a successful reset must clear the prior state.
    // The failed attempt must not have pre-cleared anything.
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    store.enqueue_failure("transient".to_string());
    let _ = service.reset_memory().expect_err("first reset should fail");

    service.reset_memory().expect("second reset should succeed");
    assert!(
        store.load_inner().is_none(),
        "successful reset must clear the prior durable state"
    );
    assert!(service.state().current_workspace.is_none());
    assert!(service.state().catalog.is_empty());
}

#[test]
fn transactional_store_failed_save_leaves_service_retryable() {
    // After a final-save failure the candidate must remain retryable, and
    // the prior Current must be preserved. Neither the failed proposal nor a
    // future save of an unrelated proposal may promote the rejected
    // candidate.
    let store = TransactingTestStore::empty();
    let mut service = WorkspaceService::from_store(store.clone());
    service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/first")),
            "/work/first",
        )
        .expect("first selection should succeed");

    store.enqueue_failure("disk full".to_string());
    store.enqueue_failure("disk still full".to_string());
    let error = service
        .select_workspace(
            &FakeRunner::with_outputs(command_outputs("/work/second")),
            "/work/second",
        )
        .expect_err("save should fail");
    assert_eq!(error.kind, WorkspaceErrorKind::StoreSaveFailed);

    // Service retains the validated candidate for Retry.
    let state = service.state();
    assert_eq!(
        state.retry_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/second"),
        "Retry must still expose the validated candidate after a save failure"
    );
    // Service Current is unchanged.
    assert_eq!(
        state.current_workspace.as_ref().map(|w| w.path.as_str()),
        Some("/work/first"),
        "Current must remain A after a failed B"
    );
}
