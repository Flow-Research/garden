import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { WorkspaceIdProvider } from '@garden/app-state/hooks'
import type { BrainFileSummary } from '../api'
import { brainFileKeys } from '../queries'
import { BrainFilesPage } from './files-page'

const mockUploadBrainFile = vi.hoisted(() => vi.fn())
const mockListBrainFolders = vi.hoisted(() => vi.fn())
const mockCreateBrainFolder = vi.hoisted(() => vi.fn())
const mockUpdateBrainFolder = vi.hoisted(() => vi.fn())
const mockDeleteBrainFolder = vi.hoisted(() => vi.fn())
const mockGetBrainFolderDetail = vi.hoisted(() => vi.fn())
const mockAddFileToBrainFolder = vi.hoisted(() => vi.fn())
const mockRemoveFileFromBrainFolder = vi.hoisted(() => vi.fn())
const mockDeleteBrainFile = vi.hoisted(() => vi.fn())
const mockGetBrainFileText = vi.hoisted(() => vi.fn())
const mockGetBrainFileExtractedText = vi.hoisted(() => vi.fn())
const mockListBrainFiles = vi.hoisted(() => vi.fn())
const mockGetBrainFileBytes = vi.hoisted(() => vi.fn())
const mockRetryBrainFile = vi.hoisted(() => vi.fn())
const mockPdfGetDocument = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  brainFileDownloadUrl: (file: { id: string }) =>
    `/api/brain/files/${encodeURIComponent(file.id)}/content?download`,
  getBrainFileText: mockGetBrainFileText,
  getBrainFileExtractedText: mockGetBrainFileExtractedText,
  listBrainFiles: mockListBrainFiles,
  retryBrainFile: mockRetryBrainFile,
  uploadBrainFile: mockUploadBrainFile,
  getBrainFileBytes: mockGetBrainFileBytes,
  listBrainFolders: mockListBrainFolders,
  createBrainFolder: mockCreateBrainFolder,
  updateBrainFolder: mockUpdateBrainFolder,
  deleteBrainFolder: mockDeleteBrainFolder,
  getBrainFolderDetail: mockGetBrainFolderDetail,
  addFileToBrainFolder: mockAddFileToBrainFolder,
  removeFileFromBrainFolder: mockRemoveFileFromBrainFolder,
  deleteBrainFile: mockDeleteBrainFile,
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {
    workerSrc: '',
  },
  getDocument: mockPdfGetDocument,
}))

const TEST_WS_ID = 'ws-test'

function renderFilesPage(initialFiles?: BrainFileSummary[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })

  if (initialFiles !== undefined) {
    queryClient.setQueryData(brainFileKeys.list(TEST_WS_ID), initialFiles)
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceIdProvider wsId={TEST_WS_ID}>
        <BrainFilesPage />
      </WorkspaceIdProvider>
    </QueryClientProvider>,
  )
}

/**
 * Confirms the file shown in the upload review modal.
 */
async function confirmSelectedFile(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog')

  await user.click(
    within(dialog).getByRole('button', {
      name: 'Add to knowledge base',
    }),
  )
}

/**
 * The recent-files list beside the dropzone — the page's only file surface
 * since the references carry no separate Knowledge Base section. Awaitable
 * because the list only renders once files exist.
 */
async function recentFilesRegion() {
  return screen.findByRole('list', { name: 'Recent files' })
}

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as CanvasRenderingContext2D,
  )
})

afterAll(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('BrainFilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListBrainFiles.mockResolvedValue([])
    mockListBrainFolders.mockResolvedValue([])
    mockDeleteBrainFile.mockResolvedValue(undefined)
    mockDeleteBrainFolder.mockResolvedValue(undefined)
    mockGetBrainFileText.mockResolvedValue('Garden preview notes')
    mockGetBrainFileExtractedText.mockResolvedValue(
      '# Quarterly report\n\nRevenue increased.',
    )
    mockGetBrainFileBytes.mockResolvedValue(
      new Uint8Array([37, 80, 68, 70]).buffer,
    )
    mockPdfGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 2,
        getPage: vi.fn().mockImplementation(async (pageNumber: number) => ({
          pageNumber,
          getViewport: ({ scale }: { scale: number }) => ({
            width: 600 * scale,
            height: 800 * scale,
          }),
          render: vi.fn(() => ({
            promise: Promise.resolve(),
            cancel: vi.fn(),
          })),
        })),
      }),
    })
  })

  it('middle-truncates long file names so they stay inside their tiles', async () => {
    const longName = `${'quarterly-report-'.repeat(10)}final.pdf`

    renderFilesPage([{ id: 'long-file', name: longName, status: 'ready' }])

    const card = await within(await recentFilesRegion()).findByTitle(longName)
    expect(card.textContent?.length).toBeLessThanOrEqual(36)
    expect(card.textContent).toContain('…')
    expect(card.textContent?.endsWith('final.pdf')).toBe(true)
    expect(screen.queryByText(longName)).not.toBeInTheDocument()
  })

  it('shows files stored in the workspace when the page loads', async () => {
    mockListBrainFiles.mockResolvedValue([
      {
        id: 'stored-file-1',
        name: 'saved-notes.txt',
        status: 'ready',
      },
    ])

    renderFilesPage()

    expect(
      await within(await recentFilesRegion()).findByText('saved-notes.txt'),
    ).toBeInTheDocument()
    expect(mockListBrainFiles).toHaveBeenCalledOnce()
  })

  it('never renders files cached under another workspace', async () => {
    // Regression: list keys were workspace-less, so a foreign cache entry
    // rendered while the refetch trailed. Keys are ws-scoped now.
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    })
    queryClient.setQueryData(brainFileKeys.list('ws-other'), [
      { id: 'foreign-file', name: 'other-workspace.pdf', status: 'ready' },
    ])
    mockListBrainFiles.mockResolvedValue([
      { id: 'own-file', name: 'own-workspace.txt', status: 'ready' },
    ])

    render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceIdProvider wsId={TEST_WS_ID}>
          <BrainFilesPage />
        </WorkspaceIdProvider>
      </QueryClientProvider>,
    )

    expect(
      await within(await recentFilesRegion()).findByText('own-workspace.txt'),
    ).toBeInTheDocument()
    expect(screen.queryByText('other-workspace.pdf')).not.toBeInTheDocument()
    expect(mockListBrainFiles).toHaveBeenCalledOnce()
  })

  it.each([
    ['report.pdf', 'PDF file'],
    ['brief.docx', 'DOC file'],
    ['budget.xlsx', 'XLS file'],
    ['sales.csv', 'CSV file'],
    ['notes.txt', 'TXT file'],
    ['readme.md', 'MD file'],
  ])('shows the %s type icon on its recent file card', async (name, label) => {
    renderFilesPage([{ id: 'file-1', name, status: 'ready' }])

    const recentList = await recentFilesRegion()

    expect(
      within(recentList).getAllByRole('img', { name: label }).length,
    ).toBeGreaterThan(0)
  })

  it('allows CSV files in the upload picker', () => {
    renderFilesPage()

    expect(
      screen.getByLabelText('Choose a document to upload'),
    ).toHaveAttribute('accept', expect.stringContaining('.csv'))
  })

  it('shows the two most recent files beside the dropzone', async () => {
    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    const recentList = await screen.findByRole('list', {
      name: 'Recent files',
    })

    expect(within(recentList).getAllByRole('listitem')).toHaveLength(2)
    expect(within(recentList).getByText('latest.pdf')).toBeInTheDocument()
    expect(within(recentList).getByText('second.docx')).toBeInTheDocument()
    expect(within(recentList).queryByText('third.txt')).not.toBeInTheDocument()
    // Non-PDF types fall back to the large type glyph instead of a rendered
    // page (the strip carries its own small glyph).
    expect(
      within(recentList)
        .getAllByRole('img', { name: 'DOC file' })
        .some((glyph) => glyph.className.includes('size-8')),
    ).toBe(true)
  })

  it('opens the preview from a recent file card', async () => {
    const user = userEvent.setup()

    renderFilesPage([{ id: 'file-1', name: 'notes.txt', status: 'ready' }])

    const recentList = await screen.findByRole('list', {
      name: 'Recent files',
    })
    await user.click(
      within(recentList).getByRole('button', {
        name: 'Open preview of notes.txt',
      }),
    )

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(mockGetBrainFileText).toHaveBeenCalledWith('file-1')
  })

  it('does not poll processing files loaded from storage', async () => {
    vi.useFakeTimers()
    mockListBrainFiles.mockResolvedValue([
      {
        id: 'stored-file-1',
        name: 'stuck-report.xlsx',
        status: 'processing',
      },
    ])

    renderFilesPage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    // Sync query on purpose: findBy* hangs under fake timers.
    expect(
      within(screen.getByRole('list', { name: 'Recent files' })).getByText(
        'stuck-report.xlsx',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Retry stuck-report.xlsx' }),
    ).toBeEnabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })

    expect(mockListBrainFiles).toHaveBeenCalledOnce()
  })

  it('shows a failed file without polling or enabling preview', async () => {
    vi.useFakeTimers()
    mockListBrainFiles.mockResolvedValue([
      {
        id: 'failed-file-1',
        name: 'broken-sheet.xlsx',
        status: 'failed',
      },
    ])

    renderFilesPage()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('Failed')).toBeInTheDocument()
    // Sync query on purpose: findBy* hangs under fake timers.
    expect(
      within(screen.getByRole('list', { name: 'Recent files' })).getByRole(
        'button',
        { name: 'Preview broken-sheet.xlsx' },
      ),
    ).toBeDisabled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })

    expect(mockListBrainFiles).toHaveBeenCalledOnce()
  })

  it('retries a failed file and refreshes its status', async () => {
    const user = userEvent.setup()

    mockRetryBrainFile.mockResolvedValue({
      id: 'failed-file-1',
      name: 'broken-sheet.xlsx',
      status: 'processing',
    })
    mockListBrainFiles.mockResolvedValue([
      {
        id: 'failed-file-1',
        name: 'broken-sheet.xlsx',
        status: 'ready',
      },
    ])

    renderFilesPage([
      {
        id: 'failed-file-1',
        name: 'broken-sheet.xlsx',
        status: 'failed',
      },
    ])

    await user.click(
      await screen.findByRole('button', {
        name: 'Retry broken-sheet.xlsx',
      }),
    )

    expect(mockRetryBrainFile).toHaveBeenCalledWith('failed-file-1')
    await waitFor(() => {
      expect(screen.queryByText('Failed')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('button', { name: 'Retry broken-sheet.xlsx' }),
      ).not.toBeInTheDocument()
    })
  })

  it('shows a retry error and keeps the recovery action available', async () => {
    const user = userEvent.setup()

    mockRetryBrainFile.mockRejectedValue(new Error('Retry unavailable'))

    renderFilesPage([
      {
        id: 'failed-file-1',
        name: 'broken-sheet.xlsx',
        status: 'failed',
      },
    ])

    const retryButton = await screen.findByRole('button', {
      name: 'Retry broken-sheet.xlsx',
    })

    await user.click(retryButton)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Retry unavailable',
    )
    expect(retryButton).toBeEnabled()
  })

  it('opens and closes a ready file preview', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      {
        id: 'stored-file-1',
        name: 'saved-notes.txt',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview saved-notes.txt',
      }),
    )

    const dialog = screen.getByRole('dialog')

    expect(
      within(dialog).getByRole('heading', { name: 'saved-notes.txt' }),
    ).toBeInTheDocument()
    expect(
      await within(dialog).findByText('Garden preview notes'),
    ).toBeInTheDocument()
    expect(mockGetBrainFileText).toHaveBeenCalledWith('stored-file-1')
    expect(
      within(dialog).getByRole('link', { name: 'Download' }),
    ).toHaveAttribute('href', '/api/brain/files/stored-file-1/content?download')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('previews CSV content as text', async () => {
    const user = userEvent.setup()
    mockGetBrainFileText.mockResolvedValueOnce(
      'region,revenue\nNorth,15300\nSouth,12900',
    )

    renderFilesPage([
      {
        id: 'stored-csv-1',
        name: 'sales.csv',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview sales.csv',
      }),
    )

    const dialog = screen.getByRole('dialog')
    expect(
      await within(dialog).findByText(/region,revenue/),
    ).toBeInTheDocument()
    expect(mockGetBrainFileText).toHaveBeenCalledWith('stored-csv-1')
  })

  it('shows a loading state while file preview content loads', async () => {
    const user = userEvent.setup()

    mockGetBrainFileText.mockReturnValueOnce(new Promise(() => {}))

    renderFilesPage([
      {
        id: 'stored-file-1',
        name: 'saved-notes.txt',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview saved-notes.txt',
      }),
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading preview...')
  })

  it('shows a preview error and lets the user try again', async () => {
    const user = userEvent.setup()

    mockGetBrainFileText
      .mockRejectedValueOnce(new Error('Preview unavailable'))
      .mockResolvedValueOnce('Recovered preview notes')

    renderFilesPage([
      {
        id: 'stored-file-1',
        name: 'saved-notes.txt',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview saved-notes.txt',
      }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load preview.',
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await screen.findByText('Recovered preview notes'),
    ).toBeInTheDocument()
    expect(mockGetBrainFileText).toHaveBeenCalledTimes(2)
  })

  it('shows PDF page thumbnails and changes the selected page', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      {
        id: 'stored-pdf-1',
        name: 'quarterly-report.pdf',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview quarterly-report.pdf',
      }),
    )

    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText('Page 1 of 2')).toBeInTheDocument()

    const pageNavigation = within(dialog).getByRole('navigation', {
      name: 'PDF pages',
    })

    expect(
      within(pageNavigation).getByRole('button', { name: 'Show page 1' }),
    ).toBeInTheDocument()

    await user.click(
      within(pageNavigation).getByRole('button', { name: 'Show page 2' }),
    )

    expect(within(dialog).getByText('Page 2 of 2')).toBeInTheDocument()
    expect(mockGetBrainFileBytes).toHaveBeenCalledWith('stored-pdf-1')
  })

  it('shows the PDF page count in the preview header', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'stored-pdf-1', name: 'quarterly-report.pdf', status: 'ready' },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview quarterly-report.pdf',
      }),
    )

    const dialog = screen.getByRole('dialog')

    expect(await within(dialog).findByText('2 pages')).toBeInTheDocument()
  })

  it('shows an unexpected PDF render failure', async () => {
    const user = userEvent.setup()
    const renderError = new Error('Canvas failed')
    renderError.name = 'PDFRenderError'
    mockPdfGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: () => ({ width: 600, height: 800 }),
          render: () => ({
            promise: Promise.reject(renderError),
            cancel: vi.fn(),
          }),
        }),
      }),
    })

    renderFilesPage([
      { id: 'stored-pdf-1', name: 'report.pdf', status: 'ready' },
    ])
    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview report.pdf',
      }),
    )

    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        alert.textContent?.includes('Could not render page 1.'),
      ),
    ).toBe(true)
  })

  it('shows extracted DOCX content in the preview', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      {
        id: 'stored-docx-1',
        name: 'quarterly-report.docx',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview quarterly-report.docx',
      }),
    )

    const dialog = screen.getByRole('dialog')

    expect(
      await within(dialog).findByRole('heading', {
        name: 'Quarterly report',
      }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Revenue increased.')).toBeInTheDocument()
    expect(mockGetBrainFileExtractedText).toHaveBeenCalledWith('stored-docx-1')
  })

  it('shows XLSX sheets and changes the selected sheet', async () => {
    const user = userEvent.setup()

    mockGetBrainFileExtractedText.mockResolvedValueOnce(
      [
        '## Revenue',
        '',
        'Month\tRevenue',
        'January\t1000',
        'February\t1250',
        '',
        '## Expenses',
        '',
        'Category\tAmount',
        'Hosting\t200',
      ].join('\n'),
    )

    renderFilesPage([
      {
        id: 'stored-xlsx-1',
        name: 'quarterly-report.xlsx',
        status: 'ready',
      },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'Preview quarterly-report.xlsx',
      }),
    )

    const dialog = screen.getByRole('dialog')
    const sheetNavigation = await within(dialog).findByRole('tablist', {
      name: 'Spreadsheet sheets',
    })

    expect(
      within(dialog).getByRole('table', { name: 'Revenue' }),
    ).toBeInTheDocument()
    const revenueTab = within(sheetNavigation).getByRole('tab', {
      name: 'Revenue',
    })
    const revenuePanel = within(dialog).getByRole('tabpanel')
    expect(revenueTab).toHaveAttribute('aria-controls', revenuePanel.id)
    expect(revenuePanel).toHaveAttribute('aria-labelledby', revenueTab.id)
    expect(within(dialog).getByText('January')).toBeInTheDocument()
    expect(within(dialog).getByText('1000')).toBeInTheDocument()

    await user.click(
      within(sheetNavigation).getByRole('tab', { name: 'Expenses' }),
    )

    expect(
      within(dialog).getByRole('table', { name: 'Expenses' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Hosting')).toBeInTheDocument()
    expect(mockGetBrainFileExtractedText).toHaveBeenCalledWith('stored-xlsx-1')
  })

  it('keeps an uploaded file when an older list request resolves late', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })
    let resolveFirstList: ((files: BrainFileSummary[]) => void) | undefined

    mockListBrainFiles
      .mockImplementationOnce(
        () =>
          new Promise<BrainFileSummary[]>((resolve) => {
            resolveFirstList = resolve
          }),
      )
      .mockResolvedValue([
        { id: 'brain-file-1', name: 'notes.txt', status: 'processing' },
      ])
    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-1',
      name: 'notes.txt',
      status: 'processing',
    })

    renderFilesPage()
    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )
    await confirmSelectedFile(user)

    expect(
      await within(await recentFilesRegion()).findByText('notes.txt'),
    ).toBeInTheDocument()

    await act(async () => {
      resolveFirstList?.([])
      await Promise.resolve()
    })

    expect(
      within(await recentFilesRegion()).getByText('notes.txt'),
    ).toBeInTheDocument()
  })

  it('uses the designed upload and file tile dimensions', async () => {
    renderFilesPage([
      {
        id: 'stored-file-1',
        name: 'saved-notes.txt',
        status: 'ready',
      },
    ])

    const uploadRegion = await screen.findByRole('region', { name: 'Upload' })
    const uploadTile = within(uploadRegion).getByRole('button', {
      name: /add your documents or drag & drop it here/i,
    })
    expect(uploadTile).toHaveClass('h-[9.5rem]', 'sm:w-[32.5rem]')

    const recentList = await recentFilesRegion()
    const fileTile = within(recentList).getByRole('listitem')
    const previewButton = within(fileTile).getByRole('button', {
      name: 'Preview saved-notes.txt',
    })
    expect(fileTile).toHaveClass('sm:w-[15.5rem]')
    expect(previewButton).toHaveClass('cursor-pointer')
  })

  it('shows folders loading instead of an empty folder list', async () => {
    mockListBrainFolders.mockReturnValue(new Promise(() => {}))
    renderFilesPage([])

    expect(await screen.findByLabelText('Loading folders')).toBeInTheDocument()
    expect(screen.queryByText('No folders yet')).toBeNull()
  })

  it('switches the Folders section between grid and list view', async () => {
    const user = userEvent.setup()

    mockListBrainFolders.mockResolvedValue([
      {
        id: 'folder-1',
        name: 'Test Case',
        privacy: 'private',
        fileCount: 0,
        createdByName: 'Fred',
        createdAt: new Date().toISOString(),
      },
    ])

    renderFilesPage()

    const foldersRegion = await screen.findByRole('region', {
      name: 'Folders',
    })
    const gridCard = await within(foldersRegion).findByRole('listitem')
    expect(gridCard).toHaveClass('sm:w-[26rem]')

    await user.click(
      within(foldersRegion).getByRole('button', {
        name: 'Folders: list view',
      }),
    )

    const listCard = await within(foldersRegion).findByRole('listitem')
    expect(listCard).not.toHaveClass('sm:w-[26rem]')
  })

  it('shows a list error and lets the user try again', async () => {
    const user = userEvent.setup()

    mockListBrainFiles.mockRejectedValueOnce(
      new Error('Brain files are unavailable'),
    )

    renderFilesPage()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load files.',
    )

    mockListBrainFiles.mockResolvedValueOnce([
      {
        id: 'recovered-file-1',
        name: 'recovered-notes.txt',
        status: 'ready',
      },
    ])

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(
      await within(await recentFilesRegion()).findByText('recovered-notes.txt'),
    ).toBeInTheDocument()
    expect(mockListBrainFiles).toHaveBeenCalledTimes(2)
  })

  it('opens the add-source menu from the dropzone and starts a pick', async () => {
    const user = userEvent.setup()
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click')

    renderFilesPage()

    await user.click(
      screen.getByRole('button', {
        name: /add your documents or drag & drop it here/i,
      }),
    )

    expect(
      await screen.findByRole('menuitem', { name: 'Add files' }),
    ).toBeInTheDocument()
    // Connector import has no backend; the item stays visible but disabled.
    expect(
      screen.getByRole('menuitem', { name: /use connector/i }),
    ).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('menuitem', { name: 'Add files' }))

    expect(inputClick).toHaveBeenCalled()
  })

  it('reviews a selected file before adding it to the knowledge base', async () => {
    const user = userEvent.setup()
    const file = new File(['Quarterly report'], 'report.pdf', {
      type: 'application/pdf',
    })

    mockUploadBrainFile.mockImplementationOnce(() => new Promise(() => {}))

    renderFilesPage()

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByRole('heading', {
        name: 'Add to knowledge base',
      }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('report.pdf')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('img', { name: 'PDF file' }),
    ).toBeInTheDocument()
    expect(mockUploadBrainFile).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', {
        name: 'Add to knowledge base',
      }),
    )

    expect(mockUploadBrainFile).toHaveBeenCalledWith(file, expect.any(Function))
    expect(
      await within(dialog).findByRole('heading', {
        name: 'Uploading your file',
      }),
    ).toBeInTheDocument()
  })

  it('middle-truncates long file names in the upload review modal', async () => {
    const user = userEvent.setup()
    const longName = `${'quarterly-report-'.repeat(10)}final.pdf`
    const file = new File(['Garden notes'], longName, { type: 'text/plain' })

    renderFilesPage()

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByTitle(longName)

    expect(name.textContent?.length).toBeLessThanOrEqual(48)
    expect(name.textContent).toContain('…')
    expect(name.textContent?.endsWith('final.pdf')).toBe(true)
    expect(within(dialog).queryByText(longName)).not.toBeInTheDocument()
  })

  it('shows byte-level progress in the upload modal', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })

    mockUploadBrainFile.mockImplementationOnce(
      (_file: File, onProgress: (percentage: number) => void) => {
        onProgress(42)
        return new Promise(() => {})
      },
    )

    renderFilesPage()

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    await confirmSelectedFile(user)

    const dialog = await screen.findByRole('dialog')

    expect(
      within(dialog).getByRole('heading', { name: 'Uploading your file' }),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('notes.txt')).toBeInTheDocument()
    expect(within(dialog).getByText('Uploading file')).toBeInTheDocument()
    expect(within(dialog).getByText('42%')).toBeInTheDocument()
    expect(
      within(dialog).getByRole('progressbar', { name: 'Uploading notes.txt' }),
    ).toHaveAttribute('aria-valuenow', '42')
  })

  it('uploads a selected file and shows its processing state', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })

    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-1',
      name: 'notes.txt',
      status: 'processing',
    })
    mockListBrainFiles.mockResolvedValue([
      {
        id: 'brain-file-1',
        name: 'notes.txt',
        status: 'processing',
      },
    ])

    renderFilesPage([])

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    await confirmSelectedFile(user)

    await waitFor(() => {
      expect(mockUploadBrainFile.mock.calls[0]?.[0]).toBe(file)
    })

    expect(
      await within(await recentFilesRegion()).findByText('notes.txt'),
    ).toBeInTheDocument()
    expect(screen.getByText('Processing')).toBeInTheDocument()
  })

  it('uploads a dropped file', async () => {
    const user = userEvent.setup()
    const file = new File(['Quarterly report'], 'report.pdf', {
      type: 'application/pdf',
    })

    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-2',
      name: 'report.pdf',
      status: 'ready',
    })

    renderFilesPage()

    fireEvent.drop(
      screen.getByRole('button', {
        name: /add your documents or drag & drop it here/i,
      }),
      {
        dataTransfer: {
          files: [file],
        },
      },
    )

    await confirmSelectedFile(user)

    await waitFor(() => {
      expect(mockUploadBrainFile.mock.calls[0]?.[0]).toBe(file)
    })

    expect(
      await within(await recentFilesRegion()).findByText('report.pdf'),
    ).toBeInTheDocument()
  })

  it('shows the upload error near the upload surface', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })

    mockUploadBrainFile.mockRejectedValue(
      new Error('The Brain service is unavailable.'),
    )

    renderFilesPage()

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    await confirmSelectedFile(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The Brain service is unavailable.',
    )
  })

  it('updates a processing file when indexing finishes', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })

    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-1',
      name: 'notes.txt',
      status: 'processing',
    })

    mockListBrainFiles.mockResolvedValue([
      {
        id: 'brain-file-1',
        name: 'notes.txt',
        status: 'ready',
      },
    ])

    renderFilesPage([])

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    await confirmSelectedFile(user)

    await waitFor(() => {
      expect(screen.queryByText('Processing')).not.toBeInTheDocument()
    })
    expect(mockListBrainFiles).toHaveBeenCalledOnce()
  })

  it('shows a status error and lets the user try again', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })

    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-1',
      name: 'notes.txt',
      status: 'processing',
    })

    mockListBrainFiles.mockRejectedValueOnce(
      new Error('Brain file status is unavailable'),
    )

    renderFilesPage([])

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    await confirmSelectedFile(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not refresh file statuses.',
    )

    mockListBrainFiles.mockResolvedValueOnce([
      {
        id: 'brain-file-1',
        name: 'notes.txt',
        status: 'ready',
      },
    ])

    await user.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => {
      expect(screen.queryByText('Processing')).not.toBeInTheDocument()
    })
  })

  it('creates a folder from the dialog with privacy', async () => {
    const user = userEvent.setup()

    mockCreateBrainFolder.mockResolvedValue({
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private',
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    })

    renderFilesPage()

    const foldersRegion = await screen.findByRole('region', {
      name: 'Folders',
    })
    await user.click(
      within(foldersRegion).getAllByRole('button', {
        name: /create a folder/i,
      })[0]!,
    )

    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByLabelText(/Folder Name/)
    await user.type(nameInput, 'Test Case')
    expect(within(dialog).getByText('9/50')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('switch'))
    await user.click(
      within(dialog).getByRole('button', { name: 'Create folder' }),
    )

    expect(mockCreateBrainFolder).toHaveBeenCalledWith({
      name: 'Test Case',
      privacy: 'private',
    })
    expect(await screen.findByText('Test Case')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the create action disabled until the folder has a name', async () => {
    const user = userEvent.setup()

    renderFilesPage()

    const foldersRegion = await screen.findByRole('region', {
      name: 'Folders',
    })
    await user.click(
      within(foldersRegion).getAllByRole('button', {
        name: /create a folder/i,
      })[0]!,
    )

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByRole('button', { name: 'Create folder' }),
    ).toBeDisabled()
    expect(within(dialog).getByText('0/50')).toBeInTheDocument()
  })

  it('creates a folder and routes its attached file through upload review', async () => {
    const user = userEvent.setup()
    const file = new File(['Quarterly report'], 'report.pdf', {
      type: 'application/pdf',
    })
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'shared' as const,
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockCreateBrainFolder.mockResolvedValue(folder)
    mockUploadBrainFile.mockResolvedValue({
      id: 'brain-file-1',
      name: 'report.pdf',
      status: 'ready',
    })
    mockAddFileToBrainFolder.mockResolvedValue({
      item: { ...folder, fileCount: 1 },
      files: [{ id: 'brain-file-1', name: 'report.pdf', status: 'ready' }],
    })

    renderFilesPage()

    const foldersRegion = await screen.findByRole('region', {
      name: 'Folders',
    })
    await user.click(
      within(foldersRegion).getAllByRole('button', {
        name: /create a folder/i,
      })[0]!,
    )

    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Folder Name/), 'Test Case')
    await user.upload(
      within(dialog).getByLabelText('Choose a file for the folder'),
      file,
    )

    expect(within(dialog).getByText('report.pdf')).toBeInTheDocument()

    await user.click(
      within(dialog).getByRole('button', { name: 'Create folder' }),
    )

    expect(mockCreateBrainFolder).toHaveBeenCalledWith({
      name: 'Test Case',
      privacy: 'shared',
    })

    await confirmSelectedFile(user)

    await waitFor(() => {
      expect(mockAddFileToBrainFolder).toHaveBeenCalledWith(
        'folder-1',
        'brain-file-1',
      )
    })
  })

  it('filters folders by the scope tabs', async () => {
    const user = userEvent.setup()

    mockListBrainFolders.mockResolvedValue([
      {
        id: 'folder-private',
        name: 'Jog_Memo',
        privacy: 'private',
        fileCount: 7,
        createdByName: 'Fred',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'folder-shared',
        name: 'Livewire fixtures',
        privacy: 'shared',
        fileCount: 12,
        createdByName: 'Fred',
        createdAt: new Date().toISOString(),
      },
    ])

    renderFilesPage()

    expect(await screen.findByText('Jog_Memo')).toBeInTheDocument()
    expect(screen.getByText('Livewire fixtures')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Private' }))
    expect(screen.getByText('Jog_Memo')).toBeInTheDocument()
    expect(screen.queryByText('Livewire fixtures')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Shared' }))
    expect(screen.queryByText('Jog_Memo')).not.toBeInTheDocument()
    expect(screen.getByText('Livewire fixtures')).toBeInTheDocument()
  })

  it('opens a folder, shows its files table, and removes a file', async () => {
    const user = userEvent.setup()
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private' as const,
      fileCount: 1,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])
    mockGetBrainFolderDetail.mockResolvedValue({
      item: folder,
      files: [
        {
          id: 'brain-file-9',
          name: 'dots-payee.pdf',
          status: 'ready',
          sizeBytes: 11_264,
          uploadedAt: '2024-07-07T13:42:00.000Z',
        },
      ],
    })
    mockRemoveFileFromBrainFolder.mockResolvedValue({
      item: { ...folder, fileCount: 0 },
      files: [],
    })

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', { name: 'Open folder Test Case' }),
    )

    expect(
      await screen.findByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument()
    expect(screen.getByText('dots-payee.pdf')).toBeInTheDocument()
    expect(screen.getByText('07 July, 2024')).toBeInTheDocument()
    expect(screen.getByText('11 KB')).toBeInTheDocument()
    // The design frame's Share button renders; sharing has no backend, so it
    // stays disabled.
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    const confirmDialog = await screen.findByRole('alertdialog')
    expect(confirmDialog).toHaveTextContent(
      'The file stays in your knowledge base.',
    )

    await user.click(
      within(confirmDialog).getByRole('button', { name: 'Delete' }),
    )

    expect(mockRemoveFileFromBrainFolder).toHaveBeenCalledWith(
      'folder-1',
      'brain-file-9',
    )
    expect(await screen.findByText('No files yet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /files & folders/i }))
    expect(
      await screen.findByRole('region', { name: 'Folders' }),
    ).toBeInTheDocument()
  })

  it('switches folder files between table and grid view', async () => {
    const user = userEvent.setup()
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private' as const,
      fileCount: 1,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])
    mockGetBrainFolderDetail.mockResolvedValue({
      item: folder,
      files: [
        {
          id: 'brain-file-9',
          name: 'dots-payee.pdf',
          status: 'ready',
          sizeBytes: 11_264,
          uploadedAt: '2024-07-07T13:42:00.000Z',
        },
      ],
    })

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', { name: 'Open folder Test Case' }),
    )

    expect(
      await screen.findByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Folder files: grid view' }),
    )

    expect(
      screen.queryByRole('columnheader', { name: 'File name' }),
    ).not.toBeInTheDocument()

    const card = screen.getByRole('listitem')
    expect(within(card).getByText('dots-payee.pdf')).toBeInTheDocument()

    await user.click(
      within(card).getByRole('button', {
        name: 'File actions for dots-payee.pdf',
      }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'View file' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: 'Delete' }))

    const confirmDialog = await screen.findByRole('alertdialog')
    expect(confirmDialog).toHaveTextContent(
      'The file stays in your knowledge base.',
    )
  })

  it('adds a file to a folder from the file card menu', async () => {
    // Submenu popups animate in with pointer-events disabled briefly.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'shared' as const,
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])
    mockAddFileToBrainFolder.mockResolvedValue({
      item: { ...folder, fileCount: 1 },
      files: [
        { id: 'stored-file-1', name: 'saved-notes.txt', status: 'ready' },
      ],
    })

    renderFilesPage([
      { id: 'stored-file-1', name: 'saved-notes.txt', status: 'ready' },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'File actions for saved-notes.txt',
      }),
    )
    await user.hover(
      await screen.findByRole('menuitem', { name: /add to folder/i }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Test Case' }))

    await waitFor(() => {
      expect(mockAddFileToBrainFolder).toHaveBeenCalledWith(
        'folder-1',
        'stored-file-1',
      )
    })
  })

  it('orders the folder header actions per design (filter, pill, create)', async () => {
    renderFilesPage()

    const foldersRegion = await screen.findByRole('region', {
      name: 'Folders',
    })
    const filter = within(foldersRegion).getByRole('button', {
      name: 'Filter folders',
    })
    const pill = within(foldersRegion).getByRole('group', {
      name: 'Folders view mode',
    })
    const create = within(foldersRegion).getAllByRole('button', {
      name: /create a folder/i,
    })[0]!

    // No folder filtering backend exists, so the funnel stays disabled.
    expect(filter).toBeDisabled()
    expect(
      filter.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      pill.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('orders folder card actions per design with unavailable ones disabled', async () => {
    const user = userEvent.setup()

    mockListBrainFolders.mockResolvedValue([
      {
        id: 'folder-1',
        name: 'Test Case',
        privacy: 'private',
        fileCount: 0,
        createdByName: 'Fred',
        createdAt: new Date().toISOString(),
      },
    ])

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'Folder actions for Test Case',
      }),
    )

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'View',
      'Rename',
      'Download',
      'Make a knowledge base',
      'Delete folder',
    ])
    // No backend for these two; they stay visible but disabled.
    expect(items[2]).toHaveAttribute('aria-disabled', 'true')
    expect(items[3]).toHaveAttribute('aria-disabled', 'true')
  })

  it('renames a folder from the card menu', async () => {
    const user = userEvent.setup()
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private' as const,
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])
    mockUpdateBrainFolder.mockResolvedValue({ ...folder, name: 'Renamed Case' })

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'Folder actions for Test Case',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    const dialog = await screen.findByRole('dialog')
    const nameInput = within(dialog).getByLabelText(/Folder Name/)
    expect(nameInput).toHaveValue('Test Case')

    await user.clear(nameInput)
    await user.type(nameInput, 'Renamed Case')
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    )

    // The PATCH payload must not carry the folder id: the strict update
    // schema rejects unknown keys, which turned every rename into a 400.
    // Privacy is omitted when unchanged — resubmitting the cached value
    // would silently revert a teammate's concurrent privacy flip.
    expect(mockUpdateBrainFolder).toHaveBeenCalledWith('folder-1', {
      name: 'Renamed Case',
    })
    expect(await screen.findByText('Renamed Case')).toBeInTheDocument()
  })

  it('sends privacy on rename only when the user flipped it', async () => {
    const user = userEvent.setup()
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private' as const,
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])
    mockUpdateBrainFolder.mockResolvedValue({ ...folder, privacy: 'shared' })

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'Folder actions for Test Case',
      }),
    )
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    const dialog = await screen.findByRole('dialog')
    await user.click(
      within(dialog).getByRole('switch', { name: /make private/i }),
    )
    await user.click(
      within(dialog).getByRole('button', { name: 'Save changes' }),
    )

    expect(mockUpdateBrainFolder).toHaveBeenCalledWith('folder-1', {
      name: 'Test Case',
      privacy: 'shared',
    })
  })

  it('deletes a folder after confirmation', async () => {
    const user = userEvent.setup()
    const folder = {
      id: 'folder-1',
      name: 'Test Case',
      privacy: 'private' as const,
      fileCount: 0,
      createdByName: 'Fred',
      createdAt: new Date().toISOString(),
    }

    mockListBrainFolders.mockResolvedValue([folder])

    renderFilesPage()

    await user.click(
      await screen.findByRole('button', {
        name: 'Folder actions for Test Case',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete folder' }),
    )

    const dialog = await screen.findByRole('alertdialog')
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    )

    expect(mockDeleteBrainFolder).toHaveBeenCalledWith('folder-1')
    expect(screen.queryByText('Test Case')).not.toBeInTheDocument()
  })

  it('deletes a file from the card menu after confirmation', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'stored-file-1', name: 'saved-notes.txt', status: 'ready' },
    ])

    await user.click(
      await within(await recentFilesRegion()).findByRole('button', {
        name: 'File actions for saved-notes.txt',
      }),
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete file' }),
    )

    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteBrainFile).toHaveBeenCalledWith('stored-file-1')
    expect(screen.queryByText('saved-notes.txt')).not.toBeInTheDocument()
  })

  it('orders the recent row and the all-files view newest-first', async () => {
    const user = userEvent.setup()

    // Deliberately oldest-first: the list API passes Helix order through
    // unsorted, so the page must enforce recency itself.
    renderFilesPage([
      {
        id: 'file-old',
        name: 'oldest.txt',
        status: 'ready',
        uploadedAt: '2024-01-01T09:00:00.000Z',
      },
      {
        id: 'file-new',
        name: 'newest.txt',
        status: 'ready',
        uploadedAt: '2024-03-03T09:00:00.000Z',
      },
      {
        id: 'file-mid',
        name: 'middle.txt',
        status: 'ready',
        uploadedAt: '2024-02-02T09:00:00.000Z',
      },
    ])

    const recentList = await recentFilesRegion()
    const recentNames = within(recentList)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(recentNames[0]).toContain('newest.txt')
    expect(recentNames[1]).toContain('middle.txt')

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    const rows = await screen.findAllByRole('row')
    const bodyNames = rows
      .slice(1)
      .map((row) => within(row).queryByText(/\.txt$/)?.textContent)
    expect(bodyNames).toEqual(['newest.txt', 'middle.txt', 'oldest.txt'])
  })

  it('shows the view-all trigger only when files exceed the recent row', async () => {
    renderFilesPage([
      { id: 'file-1', name: 'one.txt', status: 'ready' },
      { id: 'file-2', name: 'two.txt', status: 'ready' },
    ])

    await recentFilesRegion()

    expect(
      screen.queryByRole('button', { name: /view all/i }),
    ).not.toBeInTheDocument()
  })

  it('opens the full file list from the recent row and returns', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    // Table is the default; every file appears, not just the two recents.
    expect(
      await screen.findByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'All files' }),
    ).toBeInTheDocument()
    expect(screen.getByText('latest.pdf')).toBeInTheDocument()
    expect(screen.getByText('third.txt')).toBeInTheDocument()
    expect(
      screen.queryByRole('region', { name: 'Folders' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /files & folders/i }))

    expect(
      await screen.findByRole('region', { name: 'Folders' }),
    ).toBeInTheDocument()
  })

  it('switches the all-files view between table and grid', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )
    expect(
      await screen.findByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'All files: grid view' }),
    )

    expect(
      screen.queryByRole('columnheader', { name: 'File name' }),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)

    await user.click(
      screen.getByRole('button', { name: 'All files: list view' }),
    )

    expect(
      await screen.findByRole('columnheader', { name: 'File name' }),
    ).toBeInTheDocument()
  })

  it('filters the full file list by search', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'report.pdf', status: 'ready' },
      { id: 'file-2', name: 'notes.txt', status: 'ready' },
      { id: 'file-3', name: 'budget.xlsx', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    await user.type(screen.getByLabelText('Search files'), 'notes')

    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.queryByText('report.pdf')).not.toBeInTheDocument()
    expect(screen.queryByText('budget.xlsx')).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search files'))
    await user.type(screen.getByLabelText('Search files'), 'zzz')

    expect(screen.getByText(/No files match/)).toBeInTheDocument()
  })

  it('retries a failed file from the all-files view', async () => {
    const user = userEvent.setup()

    mockRetryBrainFile.mockResolvedValue({
      id: 'failed-file-1',
      name: 'broken-sheet.xlsx',
      status: 'processing',
    })

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'failed-file-1', name: 'broken-sheet.xlsx', status: 'failed' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    expect(await screen.findByText('Failed')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Retry broken-sheet.xlsx' }),
    )

    expect(mockRetryBrainFile).toHaveBeenCalledWith('failed-file-1')
  })

  it('separates table columns with vertical lines in body rows only', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    const rows = await screen.findAllByRole('row')
    const bodyCells = within(rows[1]!).getAllByRole('cell')
    expect(bodyCells[0]).not.toHaveClass('border-l')
    for (const cell of bodyCells.slice(1)) {
      expect(cell).toHaveClass('border-l')
    }

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).not.toHaveClass('border-l')
    }
  })

  it('shows the design toolbar in the all-files view with Filter disabled', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    const search = await screen.findByLabelText('Search files')
    const filter = screen.getByRole('button', { name: 'Filter' })
    const exportButton = screen.getByRole('button', { name: 'Export Data' })

    // No filtering backend; the button stays visible but disabled.
    expect(filter).toBeDisabled()
    expect(
      search.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      filter.compareDocumentPosition(exportButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('keeps View and Delete out of the table row menu but on grid cards', async () => {
    // Submenu popups animate in with pointer-events disabled briefly.
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    // Table rows carry Delete|View pills, so the ⋯ menu skips both.
    await user.click(
      await screen.findByRole('button', { name: 'File actions for third.txt' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'Download' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /add to folder/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'View file' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Delete file' }),
    ).not.toBeInTheDocument()
    await user.keyboard('{Escape}')

    // Grid cards have no pills, so their ⋯ menu keeps the full action set.
    await user.click(
      screen.getByRole('button', { name: 'All files: grid view' }),
    )
    await user.click(
      await screen.findByRole('button', { name: 'File actions for third.txt' }),
    )
    expect(
      await screen.findByRole('menuitem', { name: 'View file' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: 'Delete file' }),
    ).toBeInTheDocument()
  })

  it('deletes a file from the all-files view after confirmation', async () => {
    const user = userEvent.setup()

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    // The design frame's Action column carries a Delete pill per row.
    const row = (await screen.findAllByRole('row')).find(
      (tableRow) => within(tableRow).queryByText('third.txt') !== null,
    )
    await user.click(within(row!).getByRole('button', { name: 'Delete' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      'removes it from the knowledge base and any folders',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(mockDeleteBrainFile).toHaveBeenCalledWith('file-3')
    await waitFor(() => {
      expect(screen.queryByText('third.txt')).not.toBeInTheDocument()
    })
  })

  it('uploads a file from the all-files view', async () => {
    const user = userEvent.setup()
    const file = new File(['Garden notes'], 'notes.txt', {
      type: 'text/plain',
    })
    const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click')

    mockUploadBrainFile.mockImplementationOnce(() => new Promise(() => {}))

    renderFilesPage([
      { id: 'file-1', name: 'latest.pdf', status: 'ready' },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )

    await user.click(screen.getByRole('button', { name: 'Upload file' }))
    expect(inputClick).toHaveBeenCalled()

    await user.upload(
      screen.getByLabelText('Choose a document to upload'),
      file,
    )

    expect(await screen.findByRole('dialog')).toHaveTextContent('notes.txt')

    await confirmSelectedFile(user)

    expect(mockUploadBrainFile).toHaveBeenCalledWith(file, expect.any(Function))
  })

  it('exports the full file list as CSV from the all-files view', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock')
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() })
    let downloadName: string | undefined
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
      function (this: HTMLAnchorElement) {
        downloadName = this.download
      },
    )

    renderFilesPage([
      {
        id: 'file-1',
        name: 'report.pdf',
        status: 'ready',
        sizeBytes: 11_264,
        uploadedAt: '2024-07-07T13:42:00.000Z',
      },
      { id: 'file-2', name: 'second.docx', status: 'ready' },
      { id: 'file-3', name: 'third.txt', status: 'ready' },
    ])

    await user.click(
      await screen.findByRole('button', { name: 'View all 3 files' }),
    )
    await user.click(screen.getByRole('button', { name: 'Export Data' }))

    expect(downloadName).toBe('All files.csv')
    const blob = createObjectURL.mock.calls[0]?.[0]
    if (!blob) throw new Error('Expected the export to create a blob URL')
    const csv = await blob.text()
    expect(csv).toContain('File name,Date uploaded,Time uploaded,Size')
    expect(csv).toContain('"report.pdf",07 July, 2024')

    vi.unstubAllGlobals()
  })
})
