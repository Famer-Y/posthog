import { LemonButton, LemonLabel, LemonModal, LemonSelect } from '@posthog/lemon-ui'
import { useActions, useValues } from 'kea'
import { Form } from 'kea-forms'
import { FEATURE_FLAGS } from 'lib/constants'
import { LemonField } from 'lib/lemon-ui/LemonField'
import { featureFlagLogic } from 'lib/logic/featureFlagLogic'
import { CodeEditorInline } from 'lib/monaco/CodeEditorInline'
import { capitalizeFirstLetter } from 'lib/utils'
import EmailEditor from 'react-email-editor'

import { emailTemplaterLogic, EmailTemplaterLogicProps } from './emailTemplaterLogic'

function EmailTemplaterForm({
    mode,
    emailMetaFields,
    ...props
}: EmailTemplaterLogicProps & {
    mode: 'full' | 'preview'
}): JSX.Element {
    const { setEmailEditorRef, emailEditorReady, setIsModalOpen, applyTemplate } = useActions(
        emailTemplaterLogic(props)
    )
    const { appliedTemplate, templates, templatesLoading } = useValues(emailTemplaterLogic(props))

    const { featureFlags } = useValues(featureFlagLogic)
    const isMessagingTemplatesEnabled = featureFlags[FEATURE_FLAGS.MESSAGING_LIBRARY]

    return (
        <>
            {isMessagingTemplatesEnabled && templates.length > 0 && (
                <LemonSelect
                    className="mb-2"
                    placeholder="Start from a template (optional)"
                    loading={templatesLoading}
                    value={appliedTemplate?.id}
                    options={templates.map((template) => ({
                        label: template.name,
                        value: template.id,
                    }))}
                    onChange={(id) => {
                        const template = templates.find((t) => t.id === id)
                        if (template) {
                            applyTemplate(template)
                        }
                    }}
                    data-attr="email-template-selector"
                />
            )}
            <Form
                className="flex flex-col border rounded overflow-hidden flex-1"
                logic={props.formLogic}
                props={props.formLogicProps}
                formKey={props.formKey}
            >
                {(emailMetaFields || ['from', 'to', 'subject']).map((field) => (
                    <LemonField
                        key={field}
                        name={`${props.formFieldsPrefix ? props.formFieldsPrefix + '.' : ''}${field}`}
                        className="border-b shrink-0 gap-1 pl-2"
                        // We will handle the error display ourselves
                        renderError={() => null}
                    >
                        {({ value, onChange, error }) => (
                            <div className="flex items-center">
                                <LemonLabel className={error ? 'text-danger' : ''}>
                                    {capitalizeFirstLetter(field)}
                                </LemonLabel>
                                <CodeEditorInline
                                    embedded
                                    className="flex-1"
                                    globals={props.globals}
                                    value={value}
                                    onChange={onChange}
                                />
                            </div>
                        )}
                    </LemonField>
                ))}

                {mode === 'full' ? (
                    <EmailEditor ref={(r) => setEmailEditorRef(r)} onReady={() => emailEditorReady()} />
                ) : (
                    <LemonField
                        name={`${props.formFieldsPrefix ? props.formFieldsPrefix + '.' : ''}html`}
                        className="relative flex flex-col"
                    >
                        {({ value }) => (
                            <>
                                <div className="absolute inset-0 p-2 flex items-end justify-center transition-opacity opacity-0 hover:opacity-100">
                                    <div className="opacity-50 bg-surface-primary absolute inset-0" />
                                    <LemonButton type="primary" size="small" onClick={() => setIsModalOpen(true)}>
                                        Click to modify content
                                    </LemonButton>
                                </div>

                                <iframe srcDoc={value} className="flex-1" />
                            </>
                        )}
                    </LemonField>
                )}
            </Form>
        </>
    )
}

export function EmailTemplaterModal({ ...props }: EmailTemplaterLogicProps): JSX.Element {
    const { isModalOpen } = useValues(emailTemplaterLogic(props))
    const { setIsModalOpen, onSave } = useActions(emailTemplaterLogic(props))

    return (
        <LemonModal isOpen={isModalOpen} width="90vw" onClose={() => setIsModalOpen(false)}>
            <div className="h-[80vh] flex">
                <div className="flex flex-col flex-1">
                    <div className="shrink-0">
                        <h2>Editing email template</h2>
                    </div>
                    <EmailTemplaterForm {...props} mode="full" />
                    <div className="flex items-center mt-2 gap-2">
                        <div className="flex-1" />
                        <LemonButton onClick={() => setIsModalOpen(false)}>Cancel</LemonButton>
                        <LemonButton type="primary" onClick={() => onSave()}>
                            Save
                        </LemonButton>
                    </div>
                </div>
            </div>
        </LemonModal>
    )
}

export function EmailTemplater(props: EmailTemplaterLogicProps): JSX.Element {
    return (
        <div className="flex flex-col flex-1">
            <EmailTemplaterForm {...props} mode="preview" />
            <EmailTemplaterModal {...props} />
        </div>
    )
}
