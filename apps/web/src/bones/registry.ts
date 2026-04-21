"use client"
// Auto-generated from real app captures and adjusted for TypeScript typing.
import { registerBones } from 'boneyard-js'

import _dashboard_page from './dashboard-page.bones.json'
import _inbox_page_mobile from './inbox-page-mobile.bones.json'
import _inbox_page_desktop from './inbox-page-desktop.bones.json'
import _issues_page from './issues-page.bones.json'
import _issue_detail_page from './issue-detail-page.bones.json'
import _issue_detail_reactions from './issue-detail-reactions.bones.json'
import _issue_detail_subscribers from './issue-detail-subscribers.bones.json'
import _issue_detail_timeline from './issue-detail-timeline.bones.json'
import _skills_page from './skills-page.bones.json'
import _skills_file_tree from './skills-file-tree.bones.json'
import _skills_file_viewer from './skills-file-viewer.bones.json'

registerBones({
  "dashboard-page": _dashboard_page,
  "inbox-page-mobile": _inbox_page_mobile,
  "inbox-page-desktop": _inbox_page_desktop,
  "issues-page": _issues_page,
  "issue-detail-page": _issue_detail_page,
  "issue-detail-reactions": _issue_detail_reactions,
  "issue-detail-subscribers": _issue_detail_subscribers,
  "issue-detail-timeline": _issue_detail_timeline,
  "skills-page": _skills_page,
  "skills-file-tree": _skills_file_tree,
  "skills-file-viewer": _skills_file_viewer,
} as unknown as Parameters<typeof registerBones>[0])
