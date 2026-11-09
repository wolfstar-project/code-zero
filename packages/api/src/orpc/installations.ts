import { ORPCError } from '@orpc/server';
import { z } from 'zod';

import type { Principal } from '../access.js';
import {
  InstallationVerificationError,
  type InstallationService,
  type InstallationView,
  type SelectedRepositoryView,
  type VisibleRepository,
} from '../installations.js';
import { principalActor } from './actor.js';
import { useLogger } from './logging.js';

/** What every handler below reads from the procedure context. */
export interface InstallationContext {
  principal: Principal;
  installations?: InstallationService | undefined;
}

/** The organization is named, then membership is checked. */
export const installationOrganizationInput = z.object({ organizationId: z.string().min(1) });

export const installationScopeInput = installationOrganizationInput.extend({
  installationId: z.string().min(1),
});

/**
 * `installations.complete`'s input: exactly what the provider's callback carries.
 *
 * The organization is not here. It comes from the signed `state`, so a caller cannot name one that
 * the round trip was not started for.
 */
export const completeInstallationInput = z.object({
  state: z.string().min(1),
  installationId: z.string().min(1),
  code: z.string().min(1),
});

/** One repository to select: the provider's id, and how un-requested work may run on it. */
export const selectRepositoriesInput = installationScopeInput.extend({
  repositories: z
    .array(
      z.object({
        externalId: z.string().min(1),
        mode: z.enum(['observe', 'suggest']).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const removeRepositoryInput = installationOrganizationInput.extend({
  id: z.string().min(1),
});

const SESSION_ONLY = 'Connecting code is done from a signed-in dashboard session';
const NOT_A_MEMBER = 'You are not a member of this organization';
const NOT_A_MANAGER = 'Connecting code requires the owner or admin role';
const NO_SERVICE = 'This deployment has no installation service';
const STATE_REFUSED = 'The installation link was not issued to you, or it has expired';
const NOT_VERIFIED = 'The installation could not be verified for this account';
const ALREADY_ATTACHED = 'This installation is already attached to another organization';
const NOT_ATTACHED = 'This installation is not attached to the organization';
const NOT_VISIBLE = 'A repository is not visible to this installation';
const PROVIDER_FAILED = 'The source-control provider could not be reached';

/** `installations.start`: where to send the person to install the app. */
export async function startInstallation(
  context: InstallationContext,
  input: z.infer<typeof installationOrganizationInput>,
): Promise<{ url: string }> {
  const { service, userId } = await manager(context, 'installation.start', input.organizationId);
  const state = await service.state.sign({ userId, organizationId: input.organizationId });
  return { url: service.provider.installUrl(state) };
}

/**
 * `installations.complete`: attach what the person proved they control.
 *
 * Three things have to hold, and each is checked on the server whatever the page did: the `state`
 * was signed here for this person, they still manage the organization it names, and the provider
 * confirms they control the installation. The installation id alone is never enough.
 */
export async function completeInstallation(
  context: InstallationContext,
  input: z.infer<typeof completeInstallationInput>,
): Promise<InstallationView> {
  const service = requireService(context.installations);
  const { principal } = context;
  const target = { type: 'installation', id: input.installationId };
  const userId = sessionUser(principal, 'installation.complete', target);

  const claims = await service.state.verify(input.state);
  if (claims?.userId !== userId) refuse(principal, 'installation.complete', target, STATE_REFUSED);
  await requireManager(service, principal, 'installation.complete', target, {
    organizationId: claims.organizationId,
    userId,
  });

  let account;
  try {
    account = await service.provider.verify({
      installationId: input.installationId,
      userCode: input.code,
    });
  } catch (error) {
    if (error instanceof InstallationVerificationError) {
      refuse(principal, 'installation.complete', target, NOT_VERIFIED);
    }
    throw new ORPCError('BAD_GATEWAY', { message: PROVIDER_FAILED });
  }

  const attached = await service.store.attach({
    organizationId: claims.organizationId,
    externalId: input.installationId,
    accountLogin: account.login,
    accountType: account.type,
    createdByUserId: userId,
  });
  if (!attached.ok) {
    useLogger().audit.deny(ALREADY_ATTACHED, {
      actor: principalActor(principal),
      action: 'installation.complete',
      target,
    });
    throw new ORPCError('CONFLICT', { message: ALREADY_ATTACHED });
  }
  useLogger().audit({
    actor: principalActor(principal),
    action: 'installation.attached',
    outcome: 'success',
    target: { type: 'organization', id: claims.organizationId },
  });
  return attached.installation;
}

/** `installations.list`: the organization's installations, for any member. */
export async function listInstallations(
  context: InstallationContext,
  input: z.infer<typeof installationOrganizationInput>,
): Promise<InstallationView[]> {
  const { service } = await member(context, 'installation.list', input.organizationId);
  return service.store.list(input.organizationId);
}

/** `installations.repositories`: what one of the organization's installations can see right now. */
export async function installationRepositories(
  context: InstallationContext,
  input: z.infer<typeof installationScopeInput>,
): Promise<VisibleRepository[]> {
  const { service } = await manager(context, 'installation.repositories', input.organizationId);
  const installation = await service.store.find(input.organizationId, input.installationId);
  if (!installation) throw new ORPCError('NOT_FOUND', { message: NOT_ATTACHED });
  return visibleRepositories(service, installation);
}

/**
 * `organizationRepositories.select`: choose repositories to watch.
 *
 * The caller names provider ids only. Owner and name come from what the installation can see, so a
 * client cannot select a repository the installation does not reach by spelling its coordinates.
 */
export async function selectOrganizationRepositories(
  context: InstallationContext,
  input: z.infer<typeof selectRepositoriesInput>,
): Promise<SelectedRepositoryView[]> {
  const { service, userId } = await manager(context, 'repository.select', input.organizationId);
  const installation = await service.store.find(input.organizationId, input.installationId);
  if (!installation) throw new ORPCError('NOT_FOUND', { message: NOT_ATTACHED });

  const visible = new Map(
    (await visibleRepositories(service, installation)).map((repository) => [
      repository.externalId,
      repository,
    ]),
  );
  const chosen = input.repositories.map((choice) => {
    const repository = visible.get(choice.externalId);
    if (!repository) throw new ORPCError('BAD_REQUEST', { message: NOT_VISIBLE });
    return {
      externalId: repository.externalId,
      owner: repository.owner,
      name: repository.name,
      mode: choice.mode,
    };
  });

  const saved = await service.store.select({
    organizationId: input.organizationId,
    installationId: installation.id,
    repositories: chosen,
  });
  useLogger().audit({
    actor: principalActor(context.principal),
    action: 'repository.selected',
    outcome: 'success',
    target: { type: 'organization', id: input.organizationId, count: saved.length, by: userId },
  });
  return saved;
}

/** `organizationRepositories.list`: the selection, for any member. */
export async function listOrganizationRepositories(
  context: InstallationContext,
  input: z.infer<typeof installationOrganizationInput>,
): Promise<SelectedRepositoryView[]> {
  const { service } = await member(context, 'repository.list', input.organizationId);
  return service.store.listRepositories(input.organizationId);
}

/** `organizationRepositories.remove`: stop watching a repository. */
export async function removeOrganizationRepository(
  context: InstallationContext,
  input: z.infer<typeof removeRepositoryInput>,
): Promise<{ removed: boolean }> {
  const { service } = await manager(context, 'repository.remove', input.organizationId);
  const removed = await service.store.removeRepository(input.organizationId, input.id);
  useLogger().audit({
    actor: principalActor(context.principal),
    action: 'repository.deselected',
    outcome: removed ? 'success' : 'failure',
    target: { type: 'repository', id: input.id },
  });
  return { removed };
}

async function visibleRepositories(
  service: InstallationService,
  installation: InstallationView,
): Promise<VisibleRepository[]> {
  try {
    return await service.provider.repositories(installation.externalId);
  } catch {
    throw new ORPCError('BAD_GATEWAY', { message: PROVIDER_FAILED });
  }
}

function requireService(service: InstallationService | undefined): InstallationService {
  if (!service) throw new ORPCError('NOT_IMPLEMENTED', { message: NO_SERVICE });
  return service;
}

/** The signed-in account behind the call. Tokens and API keys act for no one in particular. */
function sessionUser(
  principal: Principal,
  action: string,
  target: { type: string; id: string },
): string {
  if (principal.kind !== 'session' || !principal.account) {
    refuse(principal, action, target, SESSION_ONLY);
  }
  return principal.account.userId;
}

async function member(context: InstallationContext, action: string, organizationId: string) {
  const service = requireService(context.installations);
  const target = { type: 'organization', id: organizationId };
  const userId = sessionUser(context.principal, action, target);
  const membership = await service.store.membership(organizationId, userId);
  // One answer for "no such organization" and "not yours", so a refusal does not reveal which
  // organizations exist.
  if (!membership) refuse(context.principal, action, target, NOT_A_MEMBER);
  return { service, userId, membership };
}

async function manager(context: InstallationContext, action: string, organizationId: string) {
  const result = await member(context, action, organizationId);
  if (!result.membership.managesPolicy) {
    refuse(context.principal, action, { type: 'organization', id: organizationId }, NOT_A_MANAGER);
  }
  return result;
}

async function requireManager(
  service: InstallationService,
  principal: Principal,
  action: string,
  target: { type: string; id: string },
  who: { organizationId: string; userId: string },
): Promise<void> {
  const membership = await service.store.membership(who.organizationId, who.userId);
  if (!membership) refuse(principal, action, target, NOT_A_MEMBER);
  if (!membership.managesPolicy) refuse(principal, action, target, NOT_A_MANAGER);
}

/** A refusal is recorded on the trail as well as thrown, as every other procedure's are. */
function refuse(
  principal: Principal,
  action: string,
  target: { type: string; id: string },
  message: string,
): never {
  useLogger().audit.deny(message, { actor: principalActor(principal), action, target });
  throw new ORPCError('FORBIDDEN', { message });
}
