import {
    IconCollapse,
    IconExpand,
    IconRefresh,
    IconThumbsDown,
    IconThumbsDownFilled,
    IconThumbsUp,
    IconThumbsUpFilled,
    IconWarning,
    IconX,
} from '@posthog/icons'
import { LemonButton, LemonButtonPropsBase, LemonInput, ProfilePicture, Spinner, Tooltip } from '@posthog/lemon-ui'
import clsx from 'clsx'
import { useActions, useValues } from 'kea'
import { BreakdownSummary, PropertiesSummary, SeriesSummary } from 'lib/components/Cards/InsightCard/InsightDetails'
import { TopHeading } from 'lib/components/Cards/InsightCard/TopHeading'
import { IconOpenInNew } from 'lib/lemon-ui/icons'
import posthog from 'posthog-js'
import React, { useMemo, useState } from 'react'
import { urls } from 'scenes/urls'
import { userLogic } from 'scenes/userLogic'
import { twMerge } from 'tailwind-merge'

import { Query } from '~/queries/Query/Query'
import {
    AssistantForm,
    AssistantMessage,
    AssistantToolCallMessage,
    FailureMessage,
    VisualizationMessage,
} from '~/queries/schema/schema-assistant-messages'
import { DataVisualizationNode, InsightVizNode, NodeKind } from '~/queries/schema/schema-general'
import { isHogQLQuery } from '~/queries/utils'

import { MarkdownMessage } from './MarkdownMessage'
import { maxLogic, MessageStatus, ThreadMessage } from './maxLogic'
import {
    castAssistantQuery,
    isAssistantMessage,
    isAssistantToolCallMessage,
    isFailureMessage,
    isHumanMessage,
    isReasoningMessage,
    isVisualizationMessage,
} from './utils'

export function Thread(): JSX.Element | null {
    const { threadGrouped } = useValues(maxLogic)

    return (
        <div className="@container/thread flex flex-col items-stretch w-full max-w-200 self-center gap-2 grow p-3">
            {threadGrouped.map((group, index) => (
                <MessageGroup key={index} messages={group} index={index} isFinal={index === threadGrouped.length - 1} />
            ))}
        </div>
    )
}

interface MessageGroupProps {
    messages: ThreadMessage[]
    isFinal: boolean
    index: number
}

function MessageGroup({ messages, isFinal: isFinalGroup }: MessageGroupProps): JSX.Element {
    const { user } = useValues(userLogic)

    const groupType = messages[0].type === 'human' ? 'human' : 'ai'

    return (
        <div
            className={clsx(
                'relative flex gap-2',
                groupType === 'human' ? 'flex-row-reverse ml-4 @md/thread:ml-10 ' : 'mr-4 @md/thread:mr-10'
            )}
        >
            <Tooltip title={groupType === 'human' ? 'You' : 'Max'}>
                <ProfilePicture
                    user={
                        groupType === 'human'
                            ? { ...user, hedgehog_config: undefined }
                            : { hedgehog_config: { ...user?.hedgehog_config, use_as_profile: true } }
                    }
                    size="lg"
                    className="hidden @md/thread:flex mt-1 border"
                />
            </Tooltip>
            <div
                className={clsx(
                    'flex flex-col gap-2 min-w-0 w-full',
                    groupType === 'human' ? 'items-end' : 'items-start'
                )}
            >
                {messages.map((message, messageIndex) => {
                    const key = message.id || messageIndex

                    if (isHumanMessage(message)) {
                        return (
                            <MessageTemplate
                                key={key}
                                type="human"
                                boxClassName={message.status === 'error' ? 'border-danger' : undefined}
                            >
                                <MarkdownMessage
                                    content={message.content || '*No text.*'}
                                    id={message.id || 'no-text'}
                                />
                            </MessageTemplate>
                        )
                    } else if (
                        isAssistantMessage(message) ||
                        isAssistantToolCallMessage(message) ||
                        isFailureMessage(message)
                    ) {
                        return (
                            <TextAnswer
                                key={key}
                                message={message}
                                interactable={messageIndex === messages.length - 1}
                                isFinalGroup={isFinalGroup}
                            />
                        )
                    } else if (isVisualizationMessage(message)) {
                        return <VisualizationAnswer key={messageIndex} message={message} status={message.status} />
                    } else if (isReasoningMessage(message)) {
                        return (
                            <MessageTemplate key={key} type="ai">
                                <div className="flex items-center gap-2">
                                    <span>{message.content}…</span>
                                    <Spinner className="text-xl" />
                                </div>
                                {message.substeps?.map((substep, substepIndex) => (
                                    <MarkdownMessage
                                        key={substepIndex}
                                        id={message.id || messageIndex.toString()}
                                        className="mt-1.5 leading-6 px-1 text-[0.6875rem] font-semibold bg-surface-secondary rounded w-fit"
                                        content={substep}
                                    />
                                ))}
                            </MessageTemplate>
                        )
                    }
                    return null // We currently skip other types of messages
                })}
                {messages.at(-1)?.status === 'error' && (
                    <MessageTemplate type="ai" boxClassName="border-warning">
                        <div className="flex items-center gap-1.5">
                            <IconWarning className="text-xl text-warning" />
                            <i>Max is generating this answer one more time because the previous attempt has failed.</i>
                        </div>
                    </MessageTemplate>
                )}
            </div>
        </div>
    )
}

interface MessageTemplateProps {
    type: 'human' | 'ai'
    action?: React.ReactNode
    className?: string
    boxClassName?: string
    children: React.ReactNode
}

const MessageTemplate = React.forwardRef<HTMLDivElement, MessageTemplateProps>(function MessageTemplate(
    { type, children, className, boxClassName, action },
    ref
) {
    return (
        <div
            className={twMerge(
                'flex flex-col gap-px w-full break-words',
                type === 'human' ? 'items-end' : 'items-start',
                className
            )}
            ref={ref}
        >
            <div
                className={twMerge(
                    'max-w-full border py-2 px-3 rounded-lg bg-surface-primary',
                    type === 'human' && 'font-medium',
                    boxClassName
                )}
            >
                {children}
            </div>
            {action}
        </div>
    )
})

interface TextAnswerProps {
    message: (AssistantMessage | FailureMessage | AssistantToolCallMessage) & ThreadMessage
    interactable?: boolean
    isFinalGroup?: boolean
}

const TextAnswer = React.forwardRef<HTMLDivElement, TextAnswerProps>(function TextAnswer(
    { message, interactable, isFinalGroup },
    ref
) {
    const retriable = !!(interactable && isFinalGroup)

    const action = (() => {
        if (message.status !== 'completed') {
            return null
        }

        // Don't show retry button when rate-limited
        if (
            isFailureMessage(message) &&
            !message.content?.includes('usage limit') && // Don't show retry button when rate-limited
            retriable
        ) {
            return <RetriableFailureActions />
        }

        if (isAssistantMessage(message) && interactable) {
            // Message has been interrupted with a form
            if (message.meta?.form?.options && isFinalGroup) {
                return <AssistantMessageForm form={message.meta.form} />
            }

            // Show answer actions if the assistant's response is complete at this point
            return <SuccessActions retriable={retriable} />
        }

        return null
    })()

    return (
        <MessageTemplate
            type="ai"
            boxClassName={message.status === 'error' || message.type === 'ai/failure' ? 'border-danger' : undefined}
            ref={ref}
            action={action}
        >
            <MarkdownMessage
                content={message.content || '*Max has failed to generate an answer. Please try again.*'}
                id={message.id || 'error'}
            />
        </MessageTemplate>
    )
})

interface AssistantMessageFormProps {
    form: AssistantForm
}

function AssistantMessageForm({ form }: AssistantMessageFormProps): JSX.Element {
    const { askMax } = useActions(maxLogic)
    return (
        <div className="flex flex-wrap gap-2 mt-1">
            {form.options.map((option) => (
                <LemonButton
                    key={option.value}
                    onClick={() => askMax(option.value)}
                    size="small"
                    type={
                        option.variant && ['primary', 'secondary', 'tertiary'].includes(option.variant)
                            ? (option.variant as LemonButtonPropsBase['type'])
                            : 'secondary'
                    }
                >
                    {option.value}
                </LemonButton>
            ))}
        </div>
    )
}

function VisualizationAnswer({
    message,
    status,
}: {
    message: VisualizationMessage
    status?: MessageStatus
}): JSX.Element | null {
    const [isSummaryShown, setIsSummaryShown] = useState(false)

    const query = useMemo<InsightVizNode | DataVisualizationNode | null>(() => {
        if (message.answer) {
            const source = castAssistantQuery(message.answer)
            if (isHogQLQuery(source)) {
                return { kind: NodeKind.DataVisualizationNode, source: source } satisfies DataVisualizationNode
            }
            return { kind: NodeKind.InsightVizNode, source, showHeader: true } satisfies InsightVizNode
        }

        return null
    }, [message])

    return status !== 'completed'
        ? null
        : query && (
              <>
                  <MessageTemplate type="ai" className="w-full" boxClassName="flex flex-col min-h-60 w-full">
                      <Query query={query} readOnly embedded />
                      <div className="flex items-center justify-between mt-2">
                          <LemonButton
                              sideIcon={isSummaryShown ? <IconCollapse /> : <IconExpand />}
                              onClick={() => setIsSummaryShown(!isSummaryShown)}
                              size="xsmall"
                              className="-m-1 shrink"
                              tooltip={isSummaryShown ? 'Hide definition' : 'Show definition'}
                          >
                              <h5 className="m-0 leading-none">
                                  <TopHeading query={query} />
                              </h5>
                          </LemonButton>
                          <LemonButton
                              to={urls.insightNew({ query })}
                              sideIcon={<IconOpenInNew />}
                              size="xsmall"
                              targetBlank
                          >
                              Open as new insight
                          </LemonButton>
                      </div>
                      {isSummaryShown && (
                          <>
                              <SeriesSummary query={query.source} heading={null} />
                              {!isHogQLQuery(query.source) && (
                                  <div className="flex flex-wrap gap-4 mt-1 *:grow">
                                      <PropertiesSummary properties={query.source.properties} />
                                      <BreakdownSummary query={query.source} />
                                  </div>
                              )}
                          </>
                      )}
                  </MessageTemplate>
              </>
          )
}

function RetriableFailureActions(): JSX.Element {
    const { retryLastMessage } = useActions(maxLogic)

    return (
        <LemonButton
            icon={<IconRefresh />}
            type="tertiary"
            size="xsmall"
            tooltip="Try again"
            onClick={() => retryLastMessage()}
            className="ml-1 -mb-1"
        >
            Try again
        </LemonButton>
    )
}

function SuccessActions({ retriable }: { retriable: boolean }): JSX.Element {
    const { traceId } = useValues(maxLogic)
    const { retryLastMessage } = useActions(maxLogic)

    const [rating, setRating] = useState<'good' | 'bad' | null>(null)
    const [feedback, setFeedback] = useState<string>('')
    const [feedbackInputStatus, setFeedbackInputStatus] = useState<'hidden' | 'pending' | 'submitted'>('hidden')

    function submitRating(newRating: 'good' | 'bad'): void {
        if (rating || !traceId) {
            return // Already rated
        }
        setRating(newRating)
        posthog.captureTraceMetric(traceId, 'quality', newRating)
        if (newRating === 'bad') {
            setFeedbackInputStatus('pending')
        }
    }

    function submitFeedback(): void {
        if (!feedback || !traceId) {
            return // Input is empty
        }
        posthog.captureTraceFeedback(traceId, feedback)
        setFeedbackInputStatus('submitted')
    }

    return (
        <>
            <div className="flex items-center ml-1 -mb-1">
                {rating !== 'bad' && (
                    <LemonButton
                        icon={rating === 'good' ? <IconThumbsUpFilled /> : <IconThumbsUp />}
                        type="tertiary"
                        size="xsmall"
                        tooltip="Good answer"
                        onClick={() => submitRating('good')}
                    />
                )}
                {rating !== 'good' && (
                    <LemonButton
                        icon={rating === 'bad' ? <IconThumbsDownFilled /> : <IconThumbsDown />}
                        type="tertiary"
                        size="xsmall"
                        tooltip="Bad answer"
                        onClick={() => submitRating('bad')}
                    />
                )}
                {retriable && (
                    <LemonButton
                        icon={<IconRefresh />}
                        type="tertiary"
                        size="xsmall"
                        tooltip="Try again"
                        onClick={() => retryLastMessage()}
                    />
                )}
            </div>
            {feedbackInputStatus !== 'hidden' && (
                <MessageTemplate type="ai">
                    <div className="flex items-center gap-1">
                        <h4 className="m-0 text-sm grow">
                            {feedbackInputStatus === 'pending'
                                ? 'What disappointed you about the answer?'
                                : 'Thank you for your feedback!'}
                        </h4>
                        <LemonButton
                            icon={<IconX />}
                            type="tertiary"
                            size="xsmall"
                            onClick={() => setFeedbackInputStatus('hidden')}
                        />
                    </div>
                    {feedbackInputStatus === 'pending' && (
                        <div className="flex w-full gap-2 items-center mt-1.5">
                            <LemonInput
                                placeholder="Help us improve Max…"
                                fullWidth
                                value={feedback}
                                onChange={(newValue) => setFeedback(newValue)}
                                onPressEnter={() => submitFeedback()}
                                autoFocus
                            />
                            <LemonButton
                                type="primary"
                                onClick={() => submitFeedback()}
                                disabledReason={!feedback ? 'Please type a few words!' : undefined}
                            >
                                Submit
                            </LemonButton>
                        </div>
                    )}
                </MessageTemplate>
            )}
        </>
    )
}
