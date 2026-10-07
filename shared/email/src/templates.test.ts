import { describe, it, expect } from 'vitest';
import { getProjectInvitationEmailContent, type ProjectInvitationEmail } from './templates.ts';

const INVITE: ProjectInvitationEmail = {
	inviterName: 'Alex Rivera',
	projectName: 'atlas',
	role: 'editor',
	inviteUrl: 'https://specboard.io/invite?token=abc',
	expiresInDays: 7,
};

describe('the project invitation email', () => {
	it('names the inviter, project and role, and links the invite', () => {
		const email = getProjectInvitationEmailContent(INVITE);

		expect(email.subject).toBe('Alex Rivera invited you to atlas on Specboard');
		expect(email.textBody).toContain('Alex Rivera invited you to atlas on Specboard as an editor.');
		expect(email.textBody).toContain(INVITE.inviteUrl);
		expect(email.htmlBody).toContain(`href="${INVITE.inviteUrl}"`);
	});

	it('says "a viewer"', () => {
		expect(getProjectInvitationEmailContent({ ...INVITE, role: 'viewer' }).textBody).toContain('as a viewer.');
	});

	it('escapes names in the HTML body', () => {
		const email = getProjectInvitationEmailContent({ ...INVITE, inviterName: '<b>Mallory</b>', projectName: 'a "q" & <script>' });

		expect(email.htmlBody).not.toContain('<b>Mallory</b>');
		expect(email.htmlBody).not.toContain('<script>');
		expect(email.htmlBody).toContain('&lt;b&gt;Mallory&lt;/b&gt;');
		expect(email.htmlBody).toContain('a &quot;q&quot; &amp; &lt;script&gt;');
	});

	it('keeps line breaks in names out of the subject', () => {
		const email = getProjectInvitationEmailContent({ ...INVITE, inviterName: 'Eve\r\nBcc: victim@example.com' });

		expect(email.subject).toBe('Eve Bcc: victim@example.com invited you to atlas on Specboard');
	});
});
