# Cloud File Editing & PR Workflow Specification

This specification defines file editing on remote/staging git repos with PR-based commit workflow.

---

## Overview

Enable users to edit files in cloud-hosted projects and commit changes via pull requests, with visual tracking of uncommitted changes in the file tree.

---

## Requirements

### File Editing on Remote Git
- Edit files on staging/remote git repositories
- Save changes locally (pending state) before committing

### PR Workflow from UI
- Open a pull request with file changes directly from the UI
- Review pending changes before creating PR
- Consider removing the save button in favor of auto-save + explicit commit

### Uncommitted Change Tracking
- Track which files in the file tree have uncommitted changes
- Visual indicator (icon, color, badge) on modified files
- Summary view of all pending changes

---

## Dependencies

- REST API & Database
- Authentication System (GitHub OAuth)

## Status

Needs design
