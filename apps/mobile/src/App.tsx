import { useState, useSyncExternalStore } from 'react'
import {
  AppState,
  Button,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { createMobileController } from './controller'
import { nativePorts } from './native-ports'
import { NativeChat } from './NativeChat'

/**
 * Native controls consume the current Garden owner interfaces. Unsupported
 * remote-host actions stay visible and unavailable until their real transport
 * is qualified. App suspension ends client reads and leaves host work alone.
 */
export default function App() {
  const [controller] = useState(() => createMobileController(nativePorts))
  const [origin, setOrigin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [subscribe] = useState(() => (listener: () => void) => {
    const unsubscribe = controller.subscribe(listener)
    const lifecycle = AppState.addEventListener('change', (next) => {
      if (next === 'active') void controller.refresh()
      else controller.suspend()
    })
    return () => {
      lifecycle.remove()
      unsubscribe()
    }
  })
  const state = useSyncExternalStore(
    subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  )
  const busy = state.phase === 'connecting'

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.page}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text accessibilityRole="header" style={styles.title}>
            Garden
          </Text>
          <Text accessibilityLiveRegion="polite">{state.message}</Text>
          {!state.accountId ? (
            <View style={styles.section}>
              <Text>Garden server</Text>
              <TextInput
                accessibilityLabel="Garden server"
                value={origin}
                onChangeText={setOrigin}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={styles.input}
              />
              <Text>Email</Text>
              <TextInput
                accessibilityLabel="Email"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                style={styles.input}
              />
              <Text>Password</Text>
              <TextInput
                accessibilityLabel="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                textContentType="password"
                style={styles.input}
              />
              <Button
                title="Sign in"
                disabled={busy || !email || !password}
                onPress={() => {
                  const entered = password
                  setPassword('')
                  void controller.connect(origin, { email, password: entered })
                }}
              />
              <Button
                title="Use saved sign-in"
                disabled={busy}
                onPress={() => {
                  void controller.connect(origin)
                }}
              />
              <Button
                title="Open saved offline reads"
                disabled={busy}
                onPress={() => {
                  void controller.openOffline(origin)
                }}
              />
              {state.phase === 'blocked' ? (
                <Button
                  title="Clear private sign-in data"
                  onPress={() => {
                    void controller.signOut()
                  }}
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.section}>
              <Text>
                Account: {state.accountId} at {state.origin}
              </Text>
              <Text accessibilityRole="header" style={styles.heading}>
                Workspace
              </Text>
              {state.workspaces.map((workspace) => (
                <Button
                  key={workspace.id}
                  disabled={
                    state.phase !== 'ready' &&
                    state.phase !== 'select-workspace'
                  }
                  title={`${state.workspaceId === workspace.id ? 'Selected: ' : ''}${workspace.name}`}
                  onPress={() => {
                    void controller.selectWorkspace(workspace.id)
                  }}
                />
              ))}
              <Button
                title="Refresh access and status"
                onPress={() => {
                  void controller.refresh()
                }}
              />
              <Button
                title="Sign out and clear private data"
                onPress={() => {
                  void controller.signOut()
                }}
              />
            </View>
          )}
          {state.workspaceId ? (
            <View style={styles.section}>
              <Text>
                Last successful task sync:{' '}
                {state.syncedAt === null
                  ? 'Unavailable'
                  : new Date(state.syncedAt).toLocaleString()}
              </Text>
              <Text>
                Saved reads: {state.cacheStatus}. Access expires:{' '}
                {state.offlineExpiresAt === null
                  ? 'Unavailable'
                  : new Date(state.offlineExpiresAt).toLocaleString()}
              </Text>
              <Text>Skills: {state.skillsCount ?? 'Unavailable'}</Text>
              <Text accessibilityRole="header" style={styles.heading}>
                Garden tasks
              </Text>
              <Text>WorkStream tasks are not available in this prototype.</Text>
              {state.tasks.map((task) => (
                <View key={task.id} style={styles.card}>
                  <Text style={styles.heading}>
                    {task.identifier}: {task.title}
                  </Text>
                  <Text>{task.status}</Text>
                  <Button
                    title={`Read run for ${task.identifier}`}
                    disabled={state.phase !== 'ready'}
                    onPress={() => {
                      void controller.selectTask(task.id)
                    }}
                  />
                </View>
              ))}
              {state.selectedTaskId ? (
                <Text>
                  Managed run:{' '}
                  {state.run
                    ? `${state.run.id} / ${state.run.status}${state.run.cancel_requested_at ? ' / cancellation requested' : ''}`
                    : state.selectedRunId
                      ? `${state.selectedRunId}: status unavailable`
                      : 'No active run or read pending'}
                </Text>
              ) : null}
              <Text accessibilityRole="header" style={styles.heading}>
                Chat threads
              </Text>
              <Button
                title="New Garden chat"
                disabled={
                  state.phase !== 'ready' || state.pendingChatId !== null
                }
                onPress={() => {
                  void controller.createChat()
                }}
              />
              {state.threads.map((thread) => (
                <Button
                  key={thread.id}
                  title={thread.title}
                  disabled={state.phase !== 'ready'}
                  onPress={() => {
                    void controller.selectThread(thread.id)
                  }}
                />
              ))}
              {state.phase === 'ready' && state.selectedThread ? (
                <NativeChat
                  key={`${state.origin}:${state.accountId}:${state.workspaceId}:${state.selectedThread.id}:${state.selectedThread.hostName}:${state.selectedThread.runtime_key}`}
                  controller={controller}
                  thread={state.selectedThread}
                  origin={state.origin}
                />
              ) : null}
              <Text>
                Chat is online only. Tool details and approvals remain in the
                web app.
              </Text>
              <Text accessibilityRole="header" style={styles.heading}>
                Private draft
              </Text>
              <TextInput
                accessibilityLabel="Private draft"
                value={state.draft}
                onChangeText={(value) => {
                  void controller.saveDraft(value)
                }}
                multiline
                maxLength={2000}
                style={[styles.input, styles.draft]}
              />
              {state.phase !== 'ready' && state.chatDraft ? (
                <View>
                  <Text>
                    Saved chat draft for {state.chatDraft.threadId}. Reconnect
                    before sending.
                  </Text>
                  <TextInput
                    accessibilityLabel="Saved chat draft"
                    value={state.chatDraft.text}
                    onChangeText={(text) => {
                      if (state.chatDraft)
                        void controller.saveChatDraft(
                          state.chatDraft.threadId,
                          text,
                        )
                    }}
                    multiline
                    maxLength={2000}
                    style={[styles.input, styles.draft]}
                  />
                </View>
              ) : null}
              <Text>
                Saved only on this device. Drafts never send an action
                automatically.
              </Text>
              <Text accessibilityRole="header" style={styles.heading}>
                Execution host
              </Text>
              <Text>
                No execution host is connected. Launch, stop, and notification
                controls are not available in this prototype.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f5f7f3' },
  content: {
    padding: 20,
    gap: 20,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  title: { fontSize: 32, fontWeight: '700', color: '#163d2a' },
  heading: { fontSize: 18, fontWeight: '600', color: '#163d2a' },
  section: { gap: 12 },
  card: {
    padding: 12,
    borderWidth: 1,
    borderColor: '#bdc9bd',
    borderRadius: 8,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#6e806e',
    borderRadius: 6,
    minHeight: 48,
    padding: 12,
    backgroundColor: '#fff',
    color: '#13271a',
  },
  draft: { minHeight: 120, textAlignVertical: 'top' },
})
